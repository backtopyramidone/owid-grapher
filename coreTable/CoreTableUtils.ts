import { dsvFormat, DSVParsedArray } from "d3-dsv"
import fastCartesian from "fast-cartesian"
import {
    findIndexFast,
    first,
    flatten,
    range,
    sampleFrom,
    slugifySameCase,
    toString,
} from "../clientUtils/Util"
import {
    CoreColumnStore,
    CoreRow,
    CoreMatrix,
    Time,
    CoreValueType,
} from "./CoreTableConstants"
import { ColumnTypeNames, CoreColumnDef } from "./CoreColumnDef"
import { ErrorValue, ErrorValueTypes } from "./ErrorValues"
import {
    OwidEntityCodeColumnDef,
    OwidEntityIdColumnDef,
    OwidEntityNameColumnDef,
    OwidTableSlugs,
} from "./OwidTableConstants"
import { ColumnSlug } from "../clientUtils/owidTypes"

export const columnStoreToRows = (
    columnStore: CoreColumnStore
): Record<string, CoreValueType>[] => {
    const firstCol = Object.values(columnStore)[0]
    if (!firstCol) return []
    const slugs = Object.keys(columnStore)
    return firstCol.map((val, index) => {
        const newRow: Record<string, CoreValueType> = {}
        slugs.forEach((slug) => {
            newRow[slug] = columnStore[slug][index]
        })
        return newRow
    })
}

// If string exceeds maxLength, will replace the end char with a ... and drop the rest
export const truncate = (str: string, maxLength: number): string =>
    str.length > maxLength ? `${str.substr(0, maxLength - 3)}...` : str

// Picks a type for each column from the first row then autotypes all rows after that so all values in
// a column will have the same type. Only chooses between strings and numbers.
const numberOnly = /^-?\d+\.?\d*$/
export const makeAutoTypeFn = (
    numericSlugs?: ColumnSlug[]
): ((object: any) => any) => {
    const slugToType: any = {}
    numericSlugs?.forEach((slug) => {
        slugToType[slug] = "number"
    })
    return (object: any): any => {
        for (const columnSlug in object) {
            const value = object[columnSlug]
            const type = slugToType[columnSlug]
            if (type === "string") {
                object[columnSlug] = value
                continue
            }

            const number = parseFloat(value) // The "+" type casting that d3 does for perf converts "" to 0, so use parseFloat.
            if (type === "number") {
                object[columnSlug] = isNaN(number)
                    ? ErrorValueTypes.NaNButShouldBeNumber
                    : number
                continue
            }

            if (isNaN(number) || !numberOnly.test(value)) {
                object[columnSlug] = value
                slugToType[columnSlug] = "string"
                continue
            }

            object[columnSlug] = number
            slugToType[columnSlug] = "number"
        }
        return object
    }
}

// Removes whitespace and non-word characters from column slugs if any exist.
// The original names are moved to the name property on the column def.
export const standardizeSlugs = (
    rows: CoreRow[]
): { rows: CoreRow[]; defs: { name: string; slug: string }[] } | undefined => {
    const firstRow = rows[0] ?? {}
    const colsToRename = Object.keys(firstRow)
        .map((name) => {
            return {
                name,
                slug: slugifySameCase(name),
            }
        })
        .filter((col) => col.name !== col.slug)
    if (!colsToRename.length) return undefined

    rows.forEach((row: CoreRow) => {
        colsToRename.forEach((col) => {
            row[col.slug] = row[col.name]
            delete row[col.name]
        })
    })

    return { rows, defs: colsToRename }
}

export const guessColumnDefFromSlugAndRow = (
    slug: string,
    sampleValue: any
): CoreColumnDef => {
    const valueType = typeof sampleValue

    const name = slug

    if (slug === "Entity")
        return {
            slug,
            type: ColumnTypeNames.EntityName,
            name,
        }

    if (slug === "day")
        return {
            slug,
            type: ColumnTypeNames.Day,
            name: "Day",
        }

    if (slug === "year" || slug === "Year")
        return {
            slug,
            type: ColumnTypeNames.Year,
            name: "Year",
        }

    if (slug === OwidTableSlugs.entityName) return OwidEntityNameColumnDef
    if (slug === OwidTableSlugs.entityCode) return OwidEntityCodeColumnDef
    if (slug === OwidTableSlugs.entityId) return OwidEntityIdColumnDef

    if (slug === "date")
        return {
            slug,
            type: ColumnTypeNames.Date,
            name: "Date",
        }

    if (valueType === "number")
        return {
            slug,
            type: ColumnTypeNames.Numeric,
            name,
        }

    if (valueType === "string") {
        if (sampleValue.match(/^\d+$/))
            return {
                slug,
                type: ColumnTypeNames.Numeric,
                name,
            }
    }

    return { slug, type: ColumnTypeNames.String, name }
}

export const makeRowFromColumnStore = (
    rowIndex: number,
    columnStore: CoreColumnStore
): CoreRow => {
    const row: CoreRow = {}
    const columns = Object.values(columnStore)
    Object.keys(columnStore).forEach((slug, colIndex) => {
        row[slug] = columns[colIndex][rowIndex]
    })
    return row
}

function isNotErrorValueOrEmptyCell<K>(
    value: K
): value is Exclude<K, ErrorValue | undefined> {
    return value !== undefined && !(value instanceof ErrorValue)
}

export interface InterpolationContext {}

export interface LinearInterpolationContext extends InterpolationContext {
    // whether to extrapolate a variable at the start or end, where we cannot do linear interpolation
    // but need to just copy over the first/last value present over to empty fields.
    // e.g. [Error, Error, 2, 3, 4] would become [2, 2, 2, 3, 4] with extrapolateAtStart=true.
    extrapolateAtStart?: boolean
    extrapolateAtEnd?: boolean
}

export interface ToleranceInterpolationContext extends InterpolationContext {
    timeTolerance: number
}

export type InterpolationProvider<C extends InterpolationContext> = (
    valuesSortedByTimeAsc: (number | ErrorValue)[],
    timesAsc: Time[],
    context: C,
    start: number,
    end: number
) => void

export function linearInterpolation(
    valuesSortedByTimeAsc: (number | ErrorValue)[],
    timesAsc: Time[],
    context: LinearInterpolationContext,
    start: number = 0,
    end: number = valuesSortedByTimeAsc.length
): void {
    if (!valuesSortedByTimeAsc.length) return

    let prevNonBlankIndex = -1
    let nextNonBlankIndex = -1

    for (let index = start; index < end; index++) {
        const currentValue = valuesSortedByTimeAsc[index]
        if (isNotErrorValueOrEmptyCell(currentValue)) {
            prevNonBlankIndex = index
            continue
        }

        if (nextNonBlankIndex === -1 || nextNonBlankIndex <= index) {
            nextNonBlankIndex = findIndexFast(
                valuesSortedByTimeAsc,
                (val) => isNotErrorValueOrEmptyCell(val),
                index + 1,
                end
            )
        }

        const prevValue = valuesSortedByTimeAsc[prevNonBlankIndex]
        const nextValue = valuesSortedByTimeAsc[nextNonBlankIndex]

        let value
        if (
            isNotErrorValueOrEmptyCell(prevValue) &&
            isNotErrorValueOrEmptyCell(nextValue)
        ) {
            const distLeft = index - prevNonBlankIndex
            const distRight = nextNonBlankIndex - index
            value =
                (prevValue * distRight + nextValue * distLeft) /
                (distLeft + distRight)
        } else if (
            isNotErrorValueOrEmptyCell(prevValue) &&
            context.extrapolateAtEnd
        )
            value = prevValue
        else if (
            isNotErrorValueOrEmptyCell(nextValue) &&
            context.extrapolateAtStart
        )
            value = nextValue
        else value = ErrorValueTypes.NoValueForInterpolation

        prevNonBlankIndex = index

        valuesSortedByTimeAsc[index] = value
    }
}

export function toleranceInterpolation(
    valuesSortedByTimeAsc: (number | ErrorValue)[],
    timesAsc: Time[],
    context: ToleranceInterpolationContext,
    start: number = 0,
    end: number = valuesSortedByTimeAsc.length
): void {
    if (!valuesSortedByTimeAsc.length) return

    let prevNonBlankIndex: number | undefined = undefined
    let nextNonBlankIndex: number | undefined = undefined

    for (let index = start; index < end; index++) {
        const currentValue = valuesSortedByTimeAsc[index]
        if (isNotErrorValueOrEmptyCell(currentValue)) {
            prevNonBlankIndex = index
            continue
        }

        if (
            nextNonBlankIndex !== -1 &&
            (nextNonBlankIndex === undefined || nextNonBlankIndex <= index)
        ) {
            nextNonBlankIndex = findIndexFast(
                valuesSortedByTimeAsc,
                isNotErrorValueOrEmptyCell,
                index + 1,
                end
            )
        }

        const timeOfCurrent = timesAsc[index]
        const timeOfPrevIndex =
            prevNonBlankIndex !== undefined
                ? timesAsc[prevNonBlankIndex]
                : -Infinity
        const timeOfNextIndex =
            nextNonBlankIndex !== undefined && nextNonBlankIndex !== -1
                ? timesAsc[nextNonBlankIndex]
                : Infinity

        const prevTimeDiff = Math.abs(timeOfPrevIndex - timeOfCurrent)
        const nextTimeDiff = Math.abs(timeOfNextIndex - timeOfCurrent)

        if (
            nextNonBlankIndex !== -1 &&
            nextTimeDiff <= prevTimeDiff &&
            nextTimeDiff <= context.timeTolerance
        ) {
            valuesSortedByTimeAsc[index] =
                valuesSortedByTimeAsc[nextNonBlankIndex!]
            timesAsc[index] = timesAsc[nextNonBlankIndex!]
        } else if (
            prevNonBlankIndex !== undefined &&
            prevTimeDiff <= context.timeTolerance
        ) {
            valuesSortedByTimeAsc[index] =
                valuesSortedByTimeAsc[prevNonBlankIndex!]
            timesAsc[index] = timesAsc[prevNonBlankIndex!]
        } else
            valuesSortedByTimeAsc[index] =
                ErrorValueTypes.NoValueWithinTolerance
    }
}

export function interpolateRowValuesWithTolerance<
    ValueSlug extends ColumnSlug,
    TimeSlug extends ColumnSlug,
    Row extends { [key in TimeSlug]?: Time } & { [key in ValueSlug]?: any }
>(
    rowsSortedByTimeAsc: Row[],
    valueSlug: ValueSlug,
    timeSlug: TimeSlug,
    timeTolerance: number
): Row[] {
    const values = rowsSortedByTimeAsc.map((row) => row[valueSlug])
    const times = rowsSortedByTimeAsc.map((row) => row[timeSlug])
    toleranceInterpolation(values, times, { timeTolerance })
    return rowsSortedByTimeAsc.map((row, index) => {
        return {
            ...row,
            [valueSlug]: values[index],
            [timeSlug]: times[index],
        }
    })
}

// A dumb function for making a function that makes a key for a row given certain columns.
export const makeKeyFn = (
    columnStore: CoreColumnStore,
    columnSlugs: ColumnSlug[]
) => (rowIndex: number): string =>
    // toString() handles `undefined` and `null` values, which can be in the table.
    columnSlugs.map((slug) => toString(columnStore[slug][rowIndex])).join(" ")

// Memoization for immutable getters. Run the function once for this instance and cache the result.
export const imemo = <Type>(
    target: unknown,
    propertyName: string,
    descriptor: TypedPropertyDescriptor<Type>
): void => {
    const originalFn = descriptor.get!
    descriptor.get = function (this: Record<string, Type>): Type {
        const propName = `${propertyName}_memoized`
        if (this[propName] === undefined) {
            // Define the prop the long way so we don't enumerate over it
            Object.defineProperty(this, propName, {
                configurable: false,
                enumerable: false,
                writable: false,
                value: originalFn.apply(this),
            })
        }
        return this[propName]
    }
}

export const appendRowsToColumnStore = (
    columnStore: CoreColumnStore,
    rows: CoreRow[]
): CoreColumnStore => {
    const slugs = Object.keys(columnStore)
    const newColumnStore = columnStore
    slugs.forEach((slug) => {
        newColumnStore[slug] = columnStore[slug].concat(
            rows.map((row) => row[slug])
        )
    })
    return newColumnStore
}

const getColumnStoreLength = (store: CoreColumnStore): number => {
    for (const slug in store) {
        return store[slug].length
    }
    return 0
}

export const concatColumnStores = (
    stores: CoreColumnStore[],
    slugsToKeep?: ColumnSlug[]
): CoreColumnStore => {
    if (!stores.length) return {}

    const lengths = stores.map(getColumnStoreLength)
    const slugs = slugsToKeep ?? Object.keys(first(stores)!)

    const newColumnStore: CoreColumnStore = {}
    slugs.forEach((slug) => {
        newColumnStore[slug] = flatten(
            stores.map(
                (store, i) =>
                    store[slug] ??
                    new Array(lengths[i]).fill(
                        ErrorValueTypes.MissingValuePlaceholder
                    )
            )
        )
    })
    return newColumnStore
}

export const rowsToColumnStore = (rows: CoreRow[]): CoreColumnStore => {
    const columnsObject: CoreColumnStore = {}
    if (!rows.length) return columnsObject

    Object.keys(rows[0]).forEach((slug) => {
        columnsObject[slug] = rows.map((row) => row[slug])
    })
    return columnsObject
}

const guessColumnDefsFromRows = (
    rows: CoreRow[],
    definedSlugs: Map<ColumnSlug, any>
): CoreColumnDef[] => {
    if (!rows[0]) return []
    return Object.keys(rows[0])
        .filter((slug) => !definedSlugs.has(slug))
        .map((slug) => {
            const firstRowWithValue = rows.find(
                (row) =>
                    row[slug] !== undefined &&
                    row[slug] !== null &&
                    row[slug] !== ""
            )
            const firstValue = firstRowWithValue
                ? firstRowWithValue[slug]
                : undefined

            return guessColumnDefFromSlugAndRow(slug, firstValue)
        })
}

export const autodetectColumnDefs = (
    rowsOrColumnStore: CoreColumnStore | CoreRow[],
    definedSlugs: Map<ColumnSlug, any>
): CoreColumnDef[] => {
    if (!Array.isArray(rowsOrColumnStore)) {
        const columnStore = rowsOrColumnStore as CoreColumnStore
        return Object.keys(columnStore)
            .filter((slug) => !definedSlugs.has(slug))
            .map((slug) => {
                return guessColumnDefFromSlugAndRow(
                    slug,
                    columnStore[slug].find(
                        (val) => val !== undefined && val !== null
                    )
                )
            })
    }
    return guessColumnDefsFromRows(rowsOrColumnStore, definedSlugs)
}

// Convenience method when you are replacing columns
export const replaceDef = <ColumnDef extends CoreColumnDef>(
    defs: ColumnDef[],
    newDefs: ColumnDef[]
): ColumnDef[] =>
    defs.map((def) => {
        const newDef = newDefs.find((newDef) => newDef.slug === def.slug)
        return newDef ?? def
    })

export const reverseColumnStore = (
    columnStore: CoreColumnStore
): CoreColumnStore => {
    const newStore: CoreColumnStore = {}
    Object.keys(columnStore).forEach((slug) => {
        newStore[slug] = columnStore[slug].slice().reverse()
    })
    return newStore
}

export const renameColumnStore = (
    columnStore: CoreColumnStore,
    columnRenameMap: { [columnSlug: string]: ColumnSlug }
): CoreColumnStore => {
    const newStore: CoreColumnStore = {}
    Object.keys(columnStore).forEach((slug) => {
        if (columnRenameMap[slug])
            newStore[columnRenameMap[slug]] = columnStore[slug]
        else newStore[slug] = columnStore[slug]
    })
    return newStore
}

export const replaceCells = (
    columnStore: CoreColumnStore,
    columnSlugs: ColumnSlug[],
    replaceFn: (val: CoreValueType) => CoreValueType
): CoreColumnStore => {
    const newStore: CoreColumnStore = { ...columnStore }
    columnSlugs.forEach((slug) => {
        newStore[slug] = newStore[slug].map(replaceFn)
    })
    return newStore
}

// Returns a Set of random indexes to drop in an array, preserving the order of the array
export const getDropIndexes = (
    arrayLength: number,
    howMany: number,
    seed = Date.now()
): Set<number> => new Set(sampleFrom(range(0, arrayLength), howMany, seed))

export const replaceRandomCellsInColumnStore = (
    columnStore: CoreColumnStore,
    howMany = 1,
    columnSlugs: ColumnSlug[] = [],
    seed = Date.now(),
    replacementGenerator: () => any = () => ErrorValueTypes.DroppedForTesting
): CoreColumnStore => {
    const newStore: CoreColumnStore = Object.assign({}, columnStore)
    columnSlugs.forEach((slug) => {
        const values = newStore[slug]
        const indexesToDrop = getDropIndexes(values.length, howMany, seed)
        newStore[slug] = values.map((value, index) =>
            indexesToDrop.has(index) ? replacementGenerator() : value
        )
    })
    return newStore
}

export class Timer {
    constructor() {
        this._tickTime = Date.now()
        this._firstTickTime = this._tickTime
    }

    private _tickTime: number
    private _firstTickTime: number

    tick(msg?: string): number {
        const elapsed = Date.now() - this._tickTime
        // eslint-disable-next-line no-console
        if (msg) console.log(`${elapsed}ms ${msg}`)
        this._tickTime = Date.now()
        return elapsed
    }

    getTotalElapsedTime(): number {
        return Date.now() - this._firstTickTime
    }
}

export const rowsFromMatrix = (matrix: CoreMatrix): any[] => {
    const table = trimMatrix(matrix)
    const header = table[0]
    return table.slice(1).map((row) => {
        const newRow: any = {}
        header.forEach((col, index) => {
            newRow[col] = row[index]
        })
        return newRow
    })
}

const trimEmptyColumns = (matrix: CoreMatrix): CoreMatrix =>
    matrix.map(trimArray)
export const trimMatrix = (matrix: CoreMatrix): CoreMatrix =>
    trimEmptyColumns(trimEmptyRows(matrix))

export const matrixToDelimited = (
    table: CoreMatrix,
    delimiter = "\t"
): string => {
    return table
        .map((row: any) =>
            row
                .map((cell: any) =>
                    cell === null || cell === undefined ? "" : cell
                )
                .join(delimiter)
        )
        .join("\n")
}

export const parseDelimited = (
    str: string,
    delimiter?: string,
    parseFn?: any
): DSVParsedArray<Record<string, unknown>> =>
    dsvFormat(delimiter ?? detectDelimiter(str)).parse(str, parseFn)

export const detectDelimiter = (str: string): "\t" | "," | " " =>
    str.includes("\t") ? "\t" : str.includes(",") ? "," : " "

export const rowsToMatrix = (rows: any[]): CoreMatrix | undefined =>
    rows.length
        ? [Object.keys(rows[0]), ...rows.map((row) => Object.values(row))]
        : undefined

const isRowEmpty = (row: any[]): boolean => row.every(isCellEmpty)

export const isCellEmpty = (cell: any): boolean =>
    cell === null || cell === undefined || cell === ""

export const trimEmptyRows = (matrix: CoreMatrix): CoreMatrix => {
    let trimAt = undefined
    for (let rowIndex = matrix.length - 1; rowIndex >= 0; rowIndex--) {
        if (!isRowEmpty(matrix[rowIndex])) break
        trimAt = rowIndex
    }
    return trimAt === undefined ? matrix : matrix.slice(0, trimAt)
}

export const trimArray = (arr: any[]): any[] => {
    let rightIndex: number
    for (rightIndex = arr.length - 1; rightIndex >= 0; rightIndex--) {
        if (!isCellEmpty(arr[rightIndex])) break
    }
    return arr.slice(0, rightIndex + 1)
}

export function cartesianProduct<T>(...allEntries: T[][]): T[][] {
    return fastCartesian(allEntries)
}

const applyNewSortOrder = (arr: any[], newOrder: number[]): any[] =>
    newOrder.map((index) => arr[index])

export const sortColumnStore = (
    columnStore: CoreColumnStore,
    slugs: ColumnSlug[]
): CoreColumnStore => {
    const firstCol = Object.values(columnStore)[0]
    if (!firstCol) return {}
    const len = firstCol.length
    const newOrder = range(0, len).sort(makeSortByFn(columnStore, slugs))
    const newStore: CoreColumnStore = {}
    Object.keys(columnStore).forEach((slug) => {
        newStore[slug] = applyNewSortOrder(columnStore[slug], newOrder)
    })
    return newStore
}

const makeSortByFn = (
    columnStore: CoreColumnStore,
    columnSlugs: ColumnSlug[]
): ((indexA: number, indexB: number) => 1 | 0 | -1) => {
    const numSlugs = columnSlugs.length
    return (indexA: number, indexB: number): 1 | 0 | -1 => {
        const nodeAFirst = -1
        const nodeBFirst = 1

        for (let slugIndex = 0; slugIndex < numSlugs; slugIndex++) {
            const slug = columnSlugs[slugIndex]
            const col = columnStore[slug]
            const av = col[indexA]
            const bv = col[indexB]
            if (av < bv) return nodeAFirst
            if (av > bv) return nodeBFirst
            // todo: handle ErrorValues
        }
        return 0
    }
}

export const emptyColumnsInFirstRowInDelimited = (str: string): string[] => {
    // todo: don't split a big string here, just do a faster first line scan
    const shortCsv = parseDelimited(str.split("\n").slice(0, 2).join("\n"))
    const firstRow: any = shortCsv[0] ?? {}
    const emptySlugs: string[] = []
    Object.keys(firstRow).forEach((slug) => {
        if (firstRow[slug] === "") emptySlugs.push(slug)
    })
    return emptySlugs
}
