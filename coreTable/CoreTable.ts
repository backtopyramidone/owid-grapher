import {
    formatYear,
    csvEscape,
    parseDelimited,
    min,
    max,
    orderBy,
    Grid,
    rowsFromGrid,
    range,
    difference,
    intersection,
    flatten,
    sum,
    differenceBy,
    uniqBy,
} from "grapher/utils/Util"
import { queryParamsToStr } from "utils/client/url"
import { CoreColumn, ColumnTypeMap } from "./CoreTableColumns"
import {
    ColumnSlug,
    CoreColumnStore,
    ColumnTypeNames,
    CoreColumnDef,
    CoreRow,
    CoreTableInputOption,
    PrimitiveType,
    SortOrder,
    Time,
    TransformType,
    ValueRange,
    CoreQuery,
    CoreValueType,
} from "./CoreTableConstants"
import {
    AlignedTextTableOptions,
    toAlignedTextTable,
    toDelimited,
    toMarkdownTable,
} from "./CoreTablePrinters"
import {
    makeAutoTypeFn,
    columnStoreToRows,
    imemo,
    makeKeyFn,
    makeRowFromColumnStore,
    standardizeSlugs,
    concatColumnStores,
    rowsToColumnStore,
    autodetectColumnDefs,
    reverseColumnStore,
    renameColumnStore,
    replaceNonPositives,
    replaceRandomCellsInColumnStore,
    getDropIndexes,
} from "./CoreTableUtils"
import { InvalidCellTypes } from "./InvalidCells"
import { OwidTableSlugs } from "./OwidTableConstants"

const TransformsRequiringCompute = new Set([
    TransformType.Load,
    TransformType.AppendRows,
    TransformType.AppendColumns,
    TransformType.UpdateRows,
])

interface AdvancedOptions {
    tableDescription?: string
    transformCategory?: TransformType
    parent?: CoreTable
    rowConversionFunction?: (row: any) => CoreRow
    filterMask?: FilterMask
}

// The complex generic with default here just enables you to optionally specify a more
// narrow interface for the input rows. This is helpful for OwidTable.
export class CoreTable<
    ROW_TYPE extends CoreRow = CoreRow,
    COL_DEF_TYPE extends CoreColumnDef = CoreColumnDef
> {
    private _columns: Map<ColumnSlug, CoreColumn> = new Map()
    protected parent?: this
    private tableDescription: string
    private transformCategory: TransformType
    private timeToLoad = 0
    private initTime = Date.now()

    private originalInput: CoreTableInputOption
    private advancedOptions: AdvancedOptions

    private inputColumnDefs: COL_DEF_TYPE[]
    constructor(
        rowsOrColumnsOrDsv: CoreTableInputOption = [],
        inputColumnDefs: COL_DEF_TYPE[] = [],
        advancedOptions: AdvancedOptions = {}
    ) {
        const start = Date.now() // Perf aid
        const {
            parent,
            tableDescription = "",
            transformCategory = TransformType.Load,
        } = advancedOptions

        this.originalInput = rowsOrColumnsOrDsv
        this.tableDescription = tableDescription
        this.transformCategory = transformCategory
        this.parent = parent as this
        this.inputColumnDefs = inputColumnDefs
        this.inputColumnDefs.forEach((def) => this.setColumn(def))
        this.advancedOptions = advancedOptions

        // If this has a parent table, than we expect all defs. This makes "deletes" and "renames" fast.
        // If this is the first input table, then we do a simple check to generate any missing column defs.
        if (!parent)
            autodetectColumnDefs(
                this.inputColumnStore,
                this._columns
            ).forEach((def) => this.setColumn(def as COL_DEF_TYPE))

        this.timeToLoad = Date.now() - start // Perf aid
    }

    // If the input is a column store, returns that. If it is DSV, parses that and turns it into a column store.
    // If it is a Rows[], turns it into a column store.
    @imemo private get inputColumnStore() {
        const { originalInput } = this

        if (typeof originalInput === "string")
            return this.delimitedAsColumnStore
        else if (Array.isArray(originalInput))
            return rowsToColumnStore(originalInput)
        return originalInput
    }

    @imemo get columnStore() {
        const {
            inputColumnStore,
            inputColumnsToComputedColumns,
            inputColumnsToParsedColumnStore,
        } = this

        // Set blank columns
        let columnStore = Object.assign({}, this.blankColumnStore)

        // Append input columns
        columnStore = Object.assign(columnStore, inputColumnStore)

        // Overwrite any non-parsed columns with parsed values
        if (Object.keys(inputColumnsToParsedColumnStore).length)
            columnStore = Object.assign(
                columnStore,
                inputColumnsToParsedColumnStore
            )

        // Adppend any computed columns
        if (Object.keys(inputColumnsToComputedColumns).length)
            columnStore = Object.assign(
                columnStore,
                inputColumnsToComputedColumns
            )

        return this.advancedOptions.filterMask
            ? this.advancedOptions.filterMask.apply(columnStore)
            : columnStore
    }

    getValuesFor(columnSlug: ColumnSlug): CoreValueType[] {
        if (!this.columnStore[columnSlug])
            throw new Error(
                `getValuesFor() was called with a columnSlug that doesn't exist on the table: ${columnSlug}`
            )

        return this.columnStore[columnSlug]
    }

    private get blankColumnStore() {
        const columnsObject: CoreColumnStore = {}
        this.columnSlugs.forEach((slug) => {
            columnsObject[slug] = []
        })
        return columnsObject
    }

    @imemo private get delimitedAsColumnStore() {
        const { originalInput, advancedOptions } = this
        const parsed = parseDelimited(
            originalInput as string,
            undefined,
            advancedOptions.rowConversionFunction ??
                makeAutoTypeFn(this._numericColumnSlugs)
        ) as any
        // dsv_parse adds a columns prop to the result we don't want since we handle our own column defs.
        // https://github.com/d3/d3-dsv#dsv_parse
        delete parsed.columns

        const renamedRows = standardizeSlugs(parsed) // todo: pass renamed defs back in.
        return rowsToColumnStore(renamedRows ? renamedRows.rows : parsed)
    }

    private get inputColumnsToComputedColumns() {
        const { colsToCompute } = this
        const columnsObject: CoreColumnStore = {}
        if (!colsToCompute.length) return columnsObject
        const rows = this.inputColumnStoreToRows
        colsToCompute.forEach((def) => {
            columnsObject[def.slug] =
                def.values ?? rows.map((row, index) => def.fn!(row, index)) // Todo: make these not operate on rows
        })

        return columnsObject
    }

    private get inputColumnsToParsedColumnStore() {
        const { inputColumnStore, colsToParse } = this
        const columnsObject: CoreColumnStore = {}
        if (!colsToParse.length) return columnsObject
        const missingCols: CoreColumn[] = []
        let len = 0
        colsToParse.forEach((col) => {
            const { slug } = col
            const unparsedVals = inputColumnStore[slug]
            if (!unparsedVals) {
                missingCols.push(col)
                return
            }
            columnsObject[slug] = unparsedVals.map((val) => col.parse(val))
            len = columnsObject[slug].length
        })

        // If column defs were provided but there were no values provided for those columns, create blank columns the same size
        // as the filled columns.
        missingCols.forEach(
            (col) =>
                (columnsObject[col.slug] = range(0, len).map(() =>
                    col.parse(undefined)
                ))
        )
        return columnsObject
    }

    private get colsToCompute() {
        // We never need to compute on certain transforms
        return TransformsRequiringCompute.has(this.transformCategory)
            ? this.newProvidedColumnDefsToCompute
            : []
    }

    @imemo private get newProvidedColumnDefsToCompute() {
        const cols = this.parent
            ? difference(this.inputColumnDefs, this.parent.defs)
            : this.inputColumnDefs
        return cols.filter((def) => def.fn || def.values)
    }

    private get colsToParse() {
        if (
            this.isOriginalInputFromDelimited ||
            this.isInputFromColumns ||
            this.parent
        )
            return []

        const firstInputRow = makeRowFromColumnStore(0, this.inputColumnStore)
        if (!firstInputRow) return []
        const allCols = this.columnsAsArray
        // The default behavior is to assume some missing or bad data in user data, so we always parse the full input the first time we load
        // user data, with the exception of computed columns.
        // Todo: measure the perf hit and add a parameter to opt out of this this if you know the data is complete?
        if (this.isRoot) {
            const colsExceptForComputeds = differenceBy(
                allCols,
                this.newProvidedColumnDefsToCompute,
                (item) => item.slug
            )
            return colsExceptForComputeds
        }

        return allCols.filter((col) =>
            col.needsParsing(firstInputRow[col.slug])
        )
    }

    @imemo private get numColsToCompute() {
        return this.colsToCompute.length
    }

    @imemo private get isOriginalInputFromDelimited() {
        return typeof this.originalInput === "string"
    }

    toOneDimensionalArray() {
        return flatten(this.toMatrix().slice(1))
    }

    private setColumn(def: COL_DEF_TYPE) {
        const { type, slug } = def
        const ColumnType = (type && ColumnTypeMap[type]) ?? ColumnTypeMap.String
        this._columns.set(slug, new ColumnType(this, def))
    }

    protected transform(
        rowsOrColumnStore: ROW_TYPE[] | CoreColumnStore,
        defs: COL_DEF_TYPE[],
        tableDescription: string,
        transformCategory: TransformType,
        filterMask?: FilterMask
    ): this {
        // The combo of the "this" return type and then casting this to any allows subclasses to create transforms of the
        // same type. The "any" typing is very brief (the returned type will have the same type as the instance being transformed).
        return new (this.constructor as any)(rowsOrColumnStore, defs, {
            parent: this,
            tableDescription,
            transformCategory,
            filterMask,
        } as AdvancedOptions)
    }

    // Time between when the parent table finished loading and this table started constructing.
    // A large time may just be due to a transform only happening after a user action, or it
    // could be do to other sync code executing between transforms.
    private get betweenTime(): number {
        return this.parent
            ? this.initTime - (this.parent.initTime + this.parent.timeToLoad)
            : 0
    }

    @imemo get rows() {
        return columnStoreToRows(this.columnStore)
    }

    @imemo get indices() {
        return range(0, this.numRows)
    }

    *[Symbol.iterator]() {
        const { columnStore, numRows } = this
        for (let index = 0; index < numRows; index++) {
            yield makeRowFromColumnStore(index, columnStore)
        }
    }

    getTimesAtIndices(indices: number[]) {
        return this.getValuesAtIndices(this.timeColumn!.slug, indices) as Time[]
    }

    getValuesAtIndices(columnSlug: ColumnSlug, indices: number[]) {
        const values = this.get(columnSlug)!.allValues
        return indices.map((index) => values[index])
    }

    @imemo get firstRow() {
        return makeRowFromColumnStore(0, this.columnStore)
    }

    @imemo get lastRow() {
        return makeRowFromColumnStore(this.numRows - 1, this.columnStore)
    }

    @imemo get numRows() {
        return this.firstColumnValues.length
    }

    @imemo private get firstColumnValues() {
        return this.firstSlug ? this.getValuesFor(this.firstSlug) : []
    }

    @imemo private get firstSlug() {
        return this.columnSlugs[0]
    }

    @imemo get numColumns() {
        return this.columnSlugs.length
    }

    get(columnSlug?: ColumnSlug) {
        return columnSlug !== undefined
            ? this._columns.get(columnSlug)
            : undefined
    }

    has(columnSlug: ColumnSlug) {
        return this._columns.has(columnSlug)
    }

    // TODO: remove this. Currently we use this to get the right day/year time formatting. For now a chart is either a "day chart" or a "year chart".
    // But we can have charts with multiple time columns. Ideally each place that needs access to the timeColumn, would get the specific column
    // and not the first time column from the table.
    @imemo get timeColumn() {
        // For now, return a day column first if present. But see note above about removing this method.
        const col =
            this.columnsAsArray.find(
                (col) => col instanceof ColumnTypeMap.Date
            ) ||
            this.columnsAsArray.find((col) => col instanceof ColumnTypeMap.Year)
        return col
            ? col
            : this.get(OwidTableSlugs.time) ??
                  this.get(OwidTableSlugs.day) ??
                  this.get(OwidTableSlugs.year)
    }

    // Todo: remove this. Generally this should not be called until the data is loaded. Even then, all calls should probably be made
    // on the column itself, and not tied tightly to the idea of a time column.
    @imemo get timeColumnFormatFunction() {
        return this.timeColumn ? this.timeColumn.formatValue : formatYear
    }

    formatTime(value: any) {
        return this.timeColumnFormatFunction(value)
    }

    @imemo private get columnsWithParseErrors() {
        return this.columnsAsArray.filter((col) => col.numInvalidCells)
    }

    @imemo get numColumnsWithInvalidCells() {
        return this.columnsWithParseErrors.length
    }

    @imemo get numInvalidCells() {
        return sum(this.columnsAsArray.map((col) => col.numInvalidCells))
    }

    @imemo get numValidCells() {
        return sum(this.columnsAsArray.map((col) => col.numValues))
    }

    get rootTable(): this {
        return this.parent ? this.parent.rootTable : this
    }

    /**
     * Returns a string map (aka index) where the keys are the combined string values of columnSlug[], and the values
     * are the indices for the rows that match.
     *
     * {country: "USA", population: 100}
     *
     * So `table.rowIndex(["country", "population"]).get("USA 100")` would return [0].
     *
     */
    rowIndex(columnSlugs: ColumnSlug[]) {
        const index = new Map<string, number[]>()
        const keyFn = makeKeyFn(this.columnStore, columnSlugs)
        this.indices.forEach((rowIndex) => {
            // todo: be smarter for string keys
            const key = keyFn(rowIndex)
            if (!index.has(key)) index.set(key, [])
            index.get(key)!.push(rowIndex)
        })
        return index
    }

    /**
     * Returns a map (aka index) where the keys are the values of the indexColumnSlug, and the values
     * are the values of the valueColumnSlug.
     *
     * {country: "USA", population: 100}
     *
     * So `table.valueIndex("country", "population").get("USA")` would return 100.
     *
     */
    protected valueIndex(
        indexColumnSlug: ColumnSlug,
        valueColumnSlug: ColumnSlug
    ) {
        const indexCol = this.get(indexColumnSlug)
        const valueCol = this.get(valueColumnSlug)

        if (!indexCol || !valueCol) return new Map()

        const indexValues = indexCol.allValues
        const valueValues = valueCol.allValues
        const indices = intersection(
            indexCol.validRowIndices,
            valueCol.validRowIndices
        )
        const map = new Map<PrimitiveType, PrimitiveType>()
        indices.forEach((index) => {
            map.set(
                indexValues[index] as PrimitiveType,
                valueValues[index] as PrimitiveType
            )
        })
        return map
    }

    grep(searchStringOrRegex: string | RegExp) {
        return this.rowFilter((row) => {
            const line = Object.values(row).join(" ")
            return typeof searchStringOrRegex === "string"
                ? line.includes(searchStringOrRegex)
                : searchStringOrRegex.test(line)
        }, `Kept rows that matched '${searchStringOrRegex.toString()}'`)
    }

    get opposite() {
        const { parent } = this
        const { filterMask } = this.advancedOptions
        if (!filterMask || !parent) return this
        return this.transform(
            parent.columnStore,
            this.defs,
            `Inversing previous filter`,
            TransformType.InverseFilterRows,
            filterMask.inverse()
        )
    }

    @imemo get oppositeColumns() {
        if (this.isRoot) return this
        const columnsToDrop = new Set(this.columnSlugs)
        const defs = this.parent!.columnsAsArray.filter(
            (col) => !columnsToDrop.has(col.slug)
        ).map((col) => col.def) as COL_DEF_TYPE[]
        return this.transform(
            this.columnStore,
            defs,
            `Inversing previous column filter`,
            TransformType.InverseFilterColumns
        )
    }

    grepColumns(searchStringOrRegex: string | RegExp) {
        const columnsToDrop = this.columnSlugs.filter((slug) => {
            return typeof searchStringOrRegex === "string"
                ? !slug.includes(searchStringOrRegex)
                : !searchStringOrRegex.test(slug)
        })

        return this.dropColumns(
            columnsToDrop,
            `Kept ${
                this.columnSlugs.length - columnsToDrop.length
            } columns that matched '${searchStringOrRegex.toString()}'.`
        )
    }

    rowFilter(
        predicate: (row: ROW_TYPE, index: number) => boolean,
        opName: string
    ) {
        return this.transform(
            this.columnStore,
            this.defs,
            opName,
            TransformType.FilterRows,
            new FilterMask(this.numRows, this.rows.map(predicate)) // Warning: this will be slow
        )
    }

    columnFilter(
        columnSlug: ColumnSlug,
        predicate: (value: CoreValueType, index: number) => boolean,
        opName: string
    ) {
        return this.transform(
            this.columnStore,
            this.defs,
            opName,
            TransformType.FilterRows,
            new FilterMask(
                this.numRows,
                this.getValuesFor(columnSlug).map(predicate)
            )
        )
    }

    sortBy(slugs: ColumnSlug[], orders?: SortOrder[]) {
        return this.transform(
            orderBy(this.rows, slugs, orders),
            this.defs,
            `Sort by ${slugs.join(",")} ${orders?.join(",") ?? ""}`,
            TransformType.SortRows
        )
    }

    sortColumns(slugs: ColumnSlug[]) {
        const first = this.getColumns(slugs)
        const rest = this.columnsAsArray.filter((col) => !first.includes(col))
        return this.transform(
            this.columnStore,
            [...first, ...rest].map((col) => col.def as COL_DEF_TYPE),
            `Sorted columns`,
            TransformType.SortColumns
        )
    }

    reverse() {
        return this.transform(
            reverseColumnStore(this.columnStore),
            this.defs,
            `Reversed row order`,
            TransformType.SortRows
        )
    }

    @imemo get defs() {
        return this.columnsAsArray.map((col) => col.def) as COL_DEF_TYPE[]
    }

    @imemo get columnNames() {
        return this.columnsAsArray.map((col) => col.name)
    }

    @imemo get columnTypes() {
        return this.columnsAsArray.map((col) => col.def.type)
    }

    @imemo get columnJsTypes() {
        return this.columnsAsArray.map((col) => col.jsType)
    }

    @imemo get columnSlugs() {
        return Array.from(this._columns.keys())
    }

    @imemo get numericColumnSlugs() {
        return this._numericColumnSlugs
    }

    private get _numericColumnSlugs() {
        return this._columnsAsArray
            .filter((col) => col instanceof ColumnTypeMap.Numeric)
            .map((col) => col.slug)
    }

    private get _columnsAsArray() {
        return Array.from(this._columns.values())
    }

    @imemo get columnsAsArray() {
        return this._columnsAsArray
    }

    getColumns(slugs: ColumnSlug[]) {
        return slugs.map((slug) => this.get(slug)!)
    }

    // Get the min and max for multiple columns at once
    domainFor(slugs: ColumnSlug[]): ValueRange {
        const cols = this.getColumns(slugs)
        const mins = cols.map((col) => col.minValue)
        const maxes = cols.map((col) => col.maxValue)
        return [min(mins), max(maxes)]
    }

    extract(slugs = this.columnSlugs) {
        return this.rows.map((row) => slugs.map((slug) => row[slug] ?? ""))
    }

    private get isRoot() {
        return !this.parent
    }

    dump(rowLimit = 30) {
        this.dumpPipeline()
        this.dumpColumns()
        this.dumpRows(rowLimit)
    }

    dumpPipeline() {
        // eslint-disable-next-line no-console
        console.table(this.ancestors.map((tb) => tb.explanation))
    }

    dumpColumns() {
        // eslint-disable-next-line no-console
        console.table(this.explainColumns)
    }

    rowsFrom(start: number, end: number) {
        if (start >= this.numRows) return []
        if (end > this.numRows) end = this.numRows
        return range(start, end).map((index) =>
            makeRowFromColumnStore(index, this.columnStore)
        )
    }

    dumpRows(rowLimit = 30) {
        // eslint-disable-next-line no-console
        console.table(this.rowsFrom(0, rowLimit), this.columnSlugs)
    }

    dumpInputTable() {
        // eslint-disable-next-line no-console
        console.table(this.inputAsTable)
    }

    @imemo private get isInputFromRowsOrDelimited() {
        return (
            Array.isArray(this.originalInput) ||
            this.isOriginalInputFromDelimited
        )
    }

    @imemo private get isInputFromColumns() {
        return !this.isInputFromRowsOrDelimited
    }

    @imemo private get inputColumnStoreToRows() {
        return columnStoreToRows(this.inputColumnStore)
    }

    @imemo private get inputAsTable() {
        return this.isInputFromRowsOrDelimited
            ? this.originalInput
            : this.inputColumnStoreToRows
    }

    @imemo private get explainColumns() {
        return this.columnsAsArray.map((col) => {
            const {
                slug,
                jsType,
                name,
                numValues,
                numInvalidCells,
                displayName,
                def,
            } = col
            return {
                slug,
                type: def.type,
                jsType,
                name,
                numValues,
                numInvalidCells,
                displayName,
                color: def.color,
            }
        })
    }

    get ancestors(): this[] {
        return this.parent ? [...this.parent.ancestors, this] : [this]
    }

    @imemo private get numColsToParse() {
        return this.colsToParse.length
    }

    private static guids = 0
    private guid = ++CoreTable.guids

    private get explanation() {
        // todo: is there a better way to do this in JS?
        const {
            tableDescription,
            transformCategory,
            guid,
            numColumns,
            numRows,
            betweenTime,
            timeToLoad,
            numColsToParse,
            numColsToCompute,
            numValidCells,
            numInvalidCells,
            numColumnsWithInvalidCells,
        } = this
        return {
            tableDescription: tableDescription.substr(0, 30),
            transformCategory,
            guid,
            numColumns,
            numRows,
            betweenTime,
            timeToLoad,
            numColsToParse,
            numColsToCompute,
            numValidCells,
            numInvalidCells,
            numColumnsWithInvalidCells,
        }
    }

    // Output a pretty table for consles
    toAlignedTextTable(options?: AlignedTextTableOptions) {
        return toAlignedTextTable(this.columnSlugs, this.rows, options)
    }

    toMarkdownTable() {
        return toMarkdownTable(this.columnSlugs, this.rows)
    }

    toDelimited(
        delimiter: string = ",",
        columnSlugs = this.columnSlugs,
        rows = this.rows
    ) {
        return toDelimited(delimiter, columnSlugs, rows)
    }

    toCsvWithColumnNames() {
        const delimiter = ","
        const header =
            this.columnsAsArray
                .map((col) => csvEscape(col.name))
                .join(delimiter) + "\n"
        const body = this.rows
            .map((row) =>
                this.columnsAsArray.map(
                    (col) => col.formatForCsv(row[col.slug]) ?? ""
                )
            )
            .map((row) => row.join(delimiter))
            .join("\n")
        return header + body
    }

    // Get all the columns that only have 1 value
    get constantColumns() {
        return this.columnsAsArray.filter((col) => col.isConstant)
    }

    rowsAt(indices: number[]) {
        const { columnStore } = this
        return indices.map((index) =>
            makeRowFromColumnStore(index, columnStore)
        )
    }

    findRows(query: CoreQuery) {
        return this.rowsAt(this.findRowsIndices(query))
    }

    findRowsIndices(query: CoreQuery) {
        const slugs = Object.keys(query)
        if (!slugs.length) return this.indices
        const arrs = this.getColumns(slugs).map((col) =>
            col.indicesWhere(query[col.slug])
        )
        return intersection(...arrs)
    }

    indexOf(row: ROW_TYPE) {
        return this.findRowsIndices(row)[0]
    }

    where(query: CoreQuery) {
        const rows = this.findRows(query)
        return this.transform(
            rows,
            this.defs,
            `Selecting ${rows.length} rows where ${queryParamsToStr(
                query as any
            ).substr(1)}`,
            TransformType.FilterRows
        )
    }

    appendRows(rows: ROW_TYPE[], opDescription: string) {
        return this.concat(
            [new (this.constructor as any)(rows, this.defs) as CoreTable],
            opDescription
        )
    }

    limit(howMany: number, offset: number = 0) {
        const start = offset
        const end = offset + howMany
        return this.transform(
            this.columnStore,
            this.defs,
            `Kept ${howMany} rows starting at ${offset}`,
            TransformType.FilterRows,
            new FilterMask(
                this.numRows,
                this.indices.map((index) => index >= start && index < end)
            )
        )
    }

    updateDefs(fn: (def: COL_DEF_TYPE) => COL_DEF_TYPE) {
        return this.transform(
            this.columnStore,
            this.defs.map(fn),
            `Updated column defs`,
            TransformType.UpdateColumnDefs
        )
    }

    limitColumns(howMany: number, offset: number = 0) {
        const slugs = this.columnSlugs.slice(offset, howMany + offset)
        return this.dropColumns(
            slugs,
            `Kept ${howMany} columns and dropped '${slugs}'`
        )
    }

    dropConstantColumns() {
        const slugs = this.constantColumns.map((col) => col.slug)
        return this.dropColumns(slugs, `Dropped constant columns '${slugs}'`)
    }

    select(slugs: ColumnSlug[]) {
        const columnsToKeep = new Set(slugs)
        const defs = this.columnsAsArray
            .filter((col) => columnsToKeep.has(col.slug))
            .map((col) => col.def) as COL_DEF_TYPE[]
        return this.transform(
            this.columnStore,
            defs,
            `Kept columns '${slugs}'`,
            TransformType.FilterColumns
        )
    }

    dropColumns(slugs: ColumnSlug[], message?: string) {
        const columnsToDrop = new Set(slugs)
        const defs = this.columnsAsArray
            .filter((col) => !columnsToDrop.has(col.slug))
            .map((col) => col.def) as COL_DEF_TYPE[]
        return this.transform(
            this.columnStore,
            defs,
            message ?? `Dropped columns '${slugs}'`,
            TransformType.FilterColumns
        )
    }

    @imemo get duplicateRowIndices() {
        const keyFn = makeKeyFn(this.columnStore, this.columnSlugs)
        const dupeSet = new Set()
        const dupeIndices: number[] = []
        this.indices.forEach((rowIndex) => {
            const key = keyFn(rowIndex)
            if (dupeSet.has(key)) dupeIndices.push(rowIndex)
            else dupeSet.add(key)
        })
        return dupeIndices
    }

    dropDuplicateRows() {
        return this.dropRowsAt(this.duplicateRowIndices)
    }

    // Todo: improve typings. After renaming a column the row interface should change. Applies to some other methods as well.
    renameColumns(columnRenameMap: { [columnSlug: string]: ColumnSlug }) {
        const oldSlugs = Object.keys(columnRenameMap)
        const newSlugs = Object.values(columnRenameMap)

        const message =
            `Renamed ` +
            oldSlugs
                .map((name, index) => `'${name}' to '${newSlugs[index]}'`)
                .join(" and ")

        return this.transform(
            renameColumnStore(this.columnStore, columnRenameMap),
            this.defs.map((def) =>
                oldSlugs.indexOf(def.slug) > -1
                    ? {
                          ...def,
                          slug: newSlugs[oldSlugs.indexOf(def.slug)],
                      }
                    : def
            ),
            message,
            TransformType.RenameColumns
        )
    }

    dropRowsAt(indices: number[], message?: string) {
        return this.transform(
            this.columnStore,
            this.defs,
            message ?? `Dropping ${indices.length} rows`,
            TransformType.FilterRows,
            new FilterMask(this.numRows, indices, false)
        )
    }

    // for testing. Preserves ordering.
    dropRandomRows(howMany = 1, seed = Date.now()) {
        if (!howMany) return this // todo: clone?
        const indexesToDrop = getDropIndexes(this.numRows, howMany, seed)
        return this.dropRowsAt(
            Array.from(indexesToDrop.values()),
            `Dropping a random ${howMany} rows`
        )
    }

    replaceNonPositiveCellsForLogScale(columnSlugs: ColumnSlug[] = []) {
        return this.transform(
            replaceNonPositives(this.columnStore, columnSlugs),
            this.defs,
            `Replaced negative or zero cells across columns ${columnSlugs.join(
                " and "
            )}`,
            TransformType.UpdateRows
        )
    }

    replaceRandomCells(
        howMany = 1,
        columnSlugs: ColumnSlug[] = [],
        seed = Date.now(),
        replacementGenerator: () => any = () =>
            InvalidCellTypes.DroppedForTesting
    ) {
        return this.transform(
            replaceRandomCellsInColumnStore(
                this.columnStore,
                howMany,
                columnSlugs,
                seed,
                replacementGenerator
            ),
            this.defs,
            `Replaced a random ${howMany} cells in ${columnSlugs.join(
                " and "
            )}`,
            TransformType.UpdateRows
        )
    }

    dropRandomPercent(dropHowMuch = 1, seed = Date.now()) {
        return this.dropRandomRows(
            Math.floor((dropHowMuch / 100) * this.numRows),
            seed
        )
    }

    isGreaterThan(
        columnSlug: ColumnSlug,
        value: PrimitiveType,
        opName?: string
    ) {
        return this.columnFilter(
            columnSlug,
            (colValue) => colValue > value,
            opName ?? `Filter where ${columnSlug} > ${value}`
        )
    }

    filterNegativesForLogScale(columnSlug: ColumnSlug) {
        return this.isGreaterThan(
            columnSlug,
            0,
            `Remove rows if ${columnSlug} is <= 0 for log scale`
        )
    }

    filterNegatives(slug: ColumnSlug) {
        return this.columnFilter(
            slug,
            (value) => value >= 0,
            `Filter negative values for ${slug}`
        )
    }

    appendColumns(defs: COL_DEF_TYPE[]) {
        return this.transform(
            this.columnStore,
            this.defs.concat(defs),
            `Appended columns ${defs
                .map((def) => `'${def.slug}'`)
                .join(" and ")}`,
            TransformType.AppendColumns
        )
    }

    // Update the table from an array of arrays (method created for loading data from Handsontable)
    // For now does a dumb overwrite
    reloadFromGrid(inputTable: Grid) {
        const rows = rowsFromGrid(inputTable)
        return this.transform(
            rows,
            this.defs,
            `Reloaded ${rows.length} rows`,
            TransformType.Reload
        )
    }

    transpose(
        by: ColumnSlug,
        columnTypeNameForNewColumns = ColumnTypeNames.Numeric
    ) {
        const newColumnSlugs = [by, ...this.get(by)!.uniqValues]
        const newColumnDefs = newColumnSlugs.map((slug) => {
            if (slug === by) return { slug }
            return {
                type: columnTypeNameForNewColumns,
                slug,
            }
        }) as COL_DEF_TYPE[]
        const newRowValues = this.columnsAsArray
            .filter((col) => col.slug !== by)
            .map((col) => [col.slug, ...col.allValues])
        return this.transform(
            rowsFromGrid([newColumnSlugs, ...newRowValues]),
            newColumnDefs,
            `Transposed`,
            TransformType.Transpose
        )
    }

    appendColumnsIfNew(defs: COL_DEF_TYPE[]) {
        return this.appendColumns(defs.filter((def) => !this.has(def.slug)))
    }

    toMatrix() {
        return [this.columnSlugs, ...this.extract()]
    }

    defToObject() {
        const output: any = {}
        this.columnsAsArray.forEach((col) => {
            output[col.slug] = col.def
        })
        return output
    }

    toJs() {
        return {
            columns: this.defToObject(),
            rows: this.rows,
        }
    }

    private join(
        destinationTable: CoreTable,
        sourceTable: CoreTable,
        by?: ColumnSlug[]
    ) {
        by =
            by ??
            intersection(sourceTable.columnSlugs, destinationTable.columnSlugs)
        const columnSlugsToAdd = difference(
            sourceTable.columnSlugs,
            destinationTable.columnSlugs
        )
        const defsToAdd = sourceTable
            .getColumns(columnSlugsToAdd)
            .map((col) => {
                const def = { ...col.def }
                def.values = []
                return def
            }) as COL_DEF_TYPE[]

        const rightIndex = sourceTable.rowIndex(by)
        const sourceColumns = sourceTable.columnStore
        const keyFn = makeKeyFn(destinationTable.columnStore, by)

        destinationTable.indices.forEach((rowIndex) => {
            const matchingRightRowIndex = rightIndex.get(keyFn(rowIndex))
            defsToAdd.forEach((def) => {
                if (matchingRightRowIndex !== undefined)
                    def.values?.push(
                        sourceColumns[def.slug][matchingRightRowIndex[0]]
                    )
                // todo: use first or last match?
                else
                    def.values?.push(
                        InvalidCellTypes.NoMatchingValueAfterJoin as any
                    )
            })
        })
        return defsToAdd
    }

    concat(tables: CoreTable[], message = `Combined tables`) {
        const all = [this, ...tables] as CoreTable[]
        const defs = flatten(all.map((table) => table.defs)) as COL_DEF_TYPE[]
        return this.transform(
            concatColumnStores(all.map((table) => table.columnStore)),
            uniqBy(defs, (def) => def.slug),
            message,
            TransformType.Concat
        )
    }

    leftJoin(rightTable: CoreTable, by?: ColumnSlug[]): this {
        return this.appendColumns(this.join(this, rightTable, by))
    }

    rightJoin(rightTable: CoreTable, by?: ColumnSlug[]): this {
        return rightTable.leftJoin(this, by) as any // todo: change parent?
    }

    innerJoin(rightTable: CoreTable, by?: ColumnSlug[]) {
        const defs = this.join(this, rightTable, by)
        const newValues = defs.map((def) => def.values)
        const rowsToDrop: number[] = []
        newValues.forEach((col) => {
            col?.forEach((value, index) => {
                if (
                    (value as any) === InvalidCellTypes.NoMatchingValueAfterJoin
                )
                    rowsToDrop.push(index)
            })
        })
        return this.appendColumns(defs).dropRowsAt(rowsToDrop)
    }

    fullJoin(rightTable: CoreTable, by?: ColumnSlug[]): this {
        return this.leftJoin(rightTable, by)
            .concat([rightTable.leftJoin(this, by)])
            .dropDuplicateRows()
    }

    indexBy(slug: ColumnSlug) {
        const map = new Map<CoreValueType, number[]>()
        this.getValuesFor(slug).map((value, index) => {
            if (!map.has(value)) map.set(value, [])
            map.get(value)!.push(index)
        })
        return map
    }

    groupBy(by: ColumnSlug) {
        const index = this.indexBy(by)
        return Array.from(index.keys()).map((groupName) =>
            this.transform(
                this.columnStore,
                this.defs,
                `Rows for group ${groupName}`,
                TransformType.FilterRows,
                new FilterMask(this.numRows, index.get(groupName)!)
            )
        )
    }

    reduce(reductionMap: ReductionMap) {
        const lastRow = { ...this.lastRow }
        Object.keys(reductionMap).forEach((slug) => {
            const prop = reductionMap[slug]
            const col = this.get(slug)!
            if (typeof prop === "string") lastRow[slug] = col[prop]
            else lastRow[slug] = prop(col)
        })
        return this.transform(
            rowsToColumnStore([lastRow]),
            this.defs,
            `Reduced table`,
            TransformType.Reduce
        )
    }
}

interface ReductionMap {
    [columnSlug: string]:
        | ReductionTypes
        | ((column: CoreColumn) => CoreValueType)
}

type ReductionTypes = keyof CoreColumn

class FilterMask {
    private mask: boolean[]
    private numRows: number
    constructor(
        numRows: number,
        input: boolean[] | number[],
        keepThese = true
    ) {
        this.numRows = numRows
        if (typeof input[0] === "number") {
            const set = new Set(input as number[])
            this.mask = range(0, numRows).map((index) =>
                set.has(index) ? keepThese : !keepThese
            )
        } else this.mask = input as boolean[]
    }

    inverse() {
        return new FilterMask(
            this.numRows,
            this.mask.map((bit) => !bit)
        )
    }

    apply(columnStore: CoreColumnStore) {
        const columnsObject: CoreColumnStore = {}
        Object.keys(columnStore).forEach((slug) => {
            columnsObject[slug] = columnStore[slug].filter(
                (slug, index) => this.mask[index]
            )
        })
        return columnsObject
    }
}
