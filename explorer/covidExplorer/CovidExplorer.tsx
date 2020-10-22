import React from "react"
import ReactDOM from "react-dom"
import { GrapherInterface } from "grapher/core/GrapherInterface"
import { Grapher } from "grapher/core/Grapher"
import {
    computed,
    action,
    observable,
    IReactionDisposer,
    Lambda,
    reaction,
} from "mobx"
import { observer } from "mobx-react"
import { bind } from "decko"
import {
    pick,
    lastOfNonEmptyArray,
    capitalize,
    mergeQueryStr,
    startCase,
    exposeInstanceOnWindow,
    last,
    isPresent,
} from "grapher/utils/Util"
import { ExplorerControlPanel } from "explorer/client/ExplorerControls"
import { allAvailableQueryStringCombos, CovidQueryParams } from "./CovidParams"
import { CountryPicker } from "grapher/controls/countryPicker/CountryPicker"
import { CovidExplorerTable } from "./CovidExplorerTable"
import { BAKED_BASE_URL } from "settings"
import moment from "moment"
import {
    covidDashboardSlug,
    coronaDefaultView,
    covidDataPath,
    sourceChartsForChartTemplates,
    metricLabels,
    intervalSpecs,
    MetricOptions,
    IntervalOptions,
    ColorScaleOptions,
    CovidCountryPickerSlugs,
} from "./CovidConstants"
import { ColorSchemes } from "grapher/color/ColorSchemes"
import {
    GlobalEntitySelection,
    GlobalEntitySelectionModes,
} from "site/globalEntityControl/GlobalEntitySelection"
import { ColorScaleConfigInterface } from "grapher/color/ColorScaleConfig"
import { BinningStrategy } from "grapher/color/BinningStrategies"
import {
    MultipleUrlBinder,
    ObservableUrl,
    UrlBinder,
} from "grapher/utils/UrlBinder"
import {
    ChartTypeName,
    DimensionProperty,
    FacetStrategy,
    ScaleType,
} from "grapher/core/GrapherConstants"
import { LegacyChartDimensionInterface } from "coreTable/LegacyVariableCode"
import { queryParamsToStr } from "utils/client/url"
import {
    getLeastUsedColor,
    fetchRequiredData,
    perCapitaDivisorByMetric,
} from "./CovidExplorerUtils"
import { ExplorerShell } from "explorer/client/ExplorerShell"
import {
    SlideShowController,
    SlideShowManager,
} from "grapher/slideshowController/SlideShowController"
import {
    ExplorerControlType,
    ExplorerControlOption,
} from "explorer/client/ExplorerConstants"
import {
    Color,
    ColumnSlug,
    CoreColumnDef,
    CsvString,
} from "coreTable/CoreTableConstants"
import { ContinentColors } from "grapher/color/ColorConstants"
import { MapProjectionName } from "grapher/mapCharts/MapProjections"
import { MegaCsvToCovidExplorerTable } from "./MegaCsv"
import { CovidAnnotationColumnDefs } from "./CovidAnnotations"

interface BootstrapProps {
    containerNode: HTMLElement
    isEmbed?: boolean // todo: what specifically does this mean? Does it mean IFF in an iframe? Or does it mean in an iframe OR hoisted?
    queryStr?: string
    globalEntitySelection?: GlobalEntitySelection
    bindToWindow?: boolean
}

interface CovidExplorerProps {
    megaCsv: CsvString
    params: CovidQueryParams
    covidChartAndVariableMeta: {
        charts: any
        variables: any
    }
    updated: string
    queryStr?: string
    isEmbed?: boolean
    globalEntitySelection?: GlobalEntitySelection
    enableKeyboardShortcuts?: boolean
    bindToWindow?: boolean
}

@observer
export class CovidExplorer
    extends React.Component<CovidExplorerProps>
    implements ObservableUrl, SlideShowManager {
    static async bootstrap(props: BootstrapProps) {
        const { megaCsv, updated, covidMeta } = await fetchRequiredData()
        const queryStr =
            props.queryStr && CovidQueryParams.hasAnyCovidParam(props.queryStr)
                ? props.queryStr
                : coronaDefaultView
        const startingParams = new CovidQueryParams(queryStr)
        return ReactDOM.render(
            <CovidExplorer
                megaCsv={megaCsv}
                updated={updated}
                params={startingParams}
                covidChartAndVariableMeta={covidMeta}
                queryStr={queryStr}
                isEmbed={props.isEmbed}
                globalEntitySelection={props.globalEntitySelection}
                enableKeyboardShortcuts={true}
                bindToWindow={props.bindToWindow}
            />,
            props.containerNode
        )
    }

    private uniqId = Math.random().toString(36).substr(2, 8)

    // Since there can be multiple explorers embedded on a page, we need to use distinct names when
    // creating radio button groups, etc.
    private getScopedName(name: string) {
        return `${name}_${this.uniqId}`
    }

    static async replaceStateAndBootstrap(
        explorerQueryStr: string,
        props: BootstrapProps
    ) {
        const queryStr = mergeQueryStr(explorerQueryStr, props.queryStr)
        window.history.replaceState(
            null,
            document.title,
            `${BAKED_BASE_URL}/${covidDashboardSlug}${queryStr}`
        )
        return CovidExplorer.bootstrap({
            ...props,
            queryStr,
        })
    }

    @observable private chartContainerRef: React.RefObject<
        HTMLDivElement
    > = React.createRef()

    private get metricPanel() {
        const options: ExplorerControlOption[] = [
            {
                available: true,
                label: metricLabels.cases,
                checked: this.constrainedParams.casesMetric,
                value: MetricOptions.cases,
            },
            {
                available: true,
                label: metricLabels.deaths,
                checked: this.constrainedParams.deathsMetric,
                value: MetricOptions.deaths,
            },

            {
                available: true,
                label: metricLabels.case_fatality_rate,
                checked: this.constrainedParams.cfrMetric,
                value: MetricOptions.case_fatality_rate,
            },
        ]

        const optionsColumn2: ExplorerControlOption[] = [
            {
                available: true,
                label: metricLabels.tests,
                checked: this.constrainedParams.testsMetric,
                value: MetricOptions.tests,
            },
            {
                available: true,
                label: metricLabels.tests_per_case,
                checked: this.constrainedParams.testsPerCaseMetric,
                value: MetricOptions.tests_per_case,
            },
            {
                available: true,
                label: metricLabels.positive_test_rate,
                checked: this.constrainedParams.positiveTestRate,
                value: MetricOptions.positive_test_rate,
            },
        ]
        return [
            <ExplorerControlPanel
                key="metric1"
                title="Metric"
                explorerSlug="covid"
                name={this.getScopedName("metric")}
                options={options}
                onChange={this.changeMetric}
                type={ExplorerControlType.Checkbox}
            />,
            <ExplorerControlPanel
                key="metric2"
                title="Metric"
                explorerSlug="covid"
                hideTitle={true}
                name={this.getScopedName("metric")}
                onChange={this.changeMetric}
                options={optionsColumn2}
                type={ExplorerControlType.Checkbox}
            />,
        ]
    }

    @action.bound private changeMetric(newValue: string, metric?: string) {
        this.props.params.toggleMetric(metric as MetricOptions)
        this.renderControlsThenUpdateGrapher()
    }

    private get frequencyPanel() {
        const writeableParams = this.props.params
        const { available } = this.constrainedParams
        const options: ExplorerControlOption[] = [
            {
                available: true,
                label: intervalSpecs.total.label,
                value: IntervalOptions.total,
            },
            {
                available: available.smoothed,
                label: intervalSpecs.smoothed.label,
                value: IntervalOptions.smoothed,
            },
            {
                available: available.daily,
                label: intervalSpecs.daily.label,
                value: IntervalOptions.daily,
            },
            {
                available: available.weekly,
                label: intervalSpecs.weekly.label,
                value: IntervalOptions.weekly,
            },
            {
                available: available.weekly,
                label: intervalSpecs.weeklyChange.label,
                value: IntervalOptions.weeklyChange,
            },
            {
                available: available.weekly,
                label: intervalSpecs.biweekly.label,
                value: IntervalOptions.biweekly,
            },
            {
                available: available.weekly,
                label: intervalSpecs.biweeklyChange.label,
                value: IntervalOptions.biweeklyChange,
            },
        ]
        return (
            <ExplorerControlPanel
                key="interval"
                title="Interval"
                type={ExplorerControlType.Dropdown}
                name={this.getScopedName("interval")}
                value={this.constrainedParams.interval}
                options={options}
                onChange={(value: string) => {
                    writeableParams.setTimeline(value as IntervalOptions)
                    this.renderControlsThenUpdateGrapher()
                }}
                explorerSlug="covid"
            />
        )
    }

    @computed private get constrainedParams() {
        return this.props.params.constrainedParams
    }

    @computed private get perCapitaPanel() {
        const { available } = this.constrainedParams
        const options: ExplorerControlOption[] = [
            {
                available: available.perCapita,
                label: capitalize(this.perCapitaOptions[this.perCapitaDivisor]),
                checked: this.constrainedParams.perCapita,
                value: "true",
            },
        ]
        return (
            <ExplorerControlPanel
                key="count"
                title="Count"
                name={this.getScopedName("count")}
                type={ExplorerControlType.Checkbox}
                options={options}
                explorerSlug="covid"
                onChange={(value) => {
                    this.props.params.perCapita = value === "true"
                    this.renderControlsThenUpdateGrapher()
                }}
            />
        )
    }

    @computed private get alignedPanel() {
        const { available } = this.constrainedParams
        const options: ExplorerControlOption[] = [
            {
                available: available.aligned,
                label: "Align outbreaks",
                checked: this.constrainedParams.aligned,
                value: "true",
            },
        ]
        return (
            <ExplorerControlPanel
                key="timeline"
                title="Timeline"
                name={this.getScopedName("timeline")}
                type={ExplorerControlType.Checkbox}
                options={options}
                onChange={(value) => {
                    this.props.params.aligned = value === "true"
                    this.renderControlsThenUpdateGrapher()
                }}
                comment={this.constrainedParams.trajectoryColumnOption.name}
                explorerSlug="covid"
            />
        )
    }

    @computed private get howLongAgo() {
        return moment.utc(this.props.updated).fromNow()
    }

    private get header() {
        return (
            <>
                <div>Coronavirus Pandemic</div>
                <div className="ExplorerTitle">Data Explorer</div>
                <div className="ExplorerSubtitle" title={this.howLongAgo}>
                    Download the complete <em>Our World in Data</em>{" "}
                    <a
                        href="https://github.com/owid/covid-19-data/tree/master/public/data"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        COVID-19 dataset.
                    </a>
                </div>
            </>
        )
    }

    private explorerSlug = "Covid"

    @computed get tableForSelection() {
        return this.expandedTable
    }

    private get countryPicker() {
        return (
            <CountryPicker
                analyticsNamespace={this.explorerSlug}
                analytics={this.grapher.analytics}
                table={this.tableForSelection}
                pickerColumnSlugs={CovidCountryPickerSlugs}
                isDropdownMenu={false}
                entityColorMap={this.countryNameToColorMap}
                manager={this.props.params}
                requiredColumnSlugs={this.activeColumnSlugs}
            />
        )
    }

    @computed private get activeColumnSlugs(): ColumnSlug[] {
        return [this.xColumn?.slug, this.yColumn?.slug].filter(isPresent)
    }

    private get panels() {
        return [
            ...this.metricPanel,
            this.frequencyPanel,
            this.perCapitaPanel,
            this.alignedPanel,
        ]
    }

    render() {
        return (
            <ExplorerShell
                headerElement={this.header}
                controlPanels={this.panels}
                explorerSlug={this.explorerSlug}
                countryPickerElement={this.countryPicker}
                hideControls={this.props.params.hideControls}
                isEmbed={!!this.props.isEmbed}
                ref={this.explorerRef}
                enableKeyboardShortcuts={this.props.enableKeyboardShortcuts}
            />
        )
    }

    @observable.ref explorerRef: React.RefObject<
        ExplorerShell
    > = React.createRef()

    @computed private get showExplorerControls() {
        return !this.props.params.hideControls || !this.props.isEmbed
    }

    @computed private get perCapitaDivisor() {
        return perCapitaDivisorByMetric(this.constrainedParams.metricName)
    }

    @computed private get perCapitaOptions() {
        return {
            1: "",
            1e3: "per 1,000 people",
            1e6: "per million people",
        }
    }

    private perCapitaTitle(metric: MetricOptions) {
        return this.constrainedParams.perCapita
            ? " " + this.perCapitaOptions[perCapitaDivisorByMetric(metric)]
            : ""
    }

    @computed private get chartTitle() {
        let title = ""
        const params = this.constrainedParams
        const interval = params.interval

        const isCumulative = interval === IntervalOptions.total
        const freq = params.intervalTitle
        if (params.cfrMetric)
            title = `Case fatality rate of the ongoing COVID-19 pandemic`
        else if (params.positiveTestRate)
            title = `The share of ${
                isCumulative ? "" : "daily "
            }COVID-19 tests that are positive`
        else if (params.testsPerCaseMetric)
            title = `${
                isCumulative ? `Cumulative tests` : `Tests`
            } conducted per confirmed case of COVID-19`
        else if (params.testsMetric) title = `${freq} COVID-19 tests`
        else if (params.deathsMetric)
            title = `${freq} confirmed COVID-19 deaths`
        else if (params.casesMetric) title = `${freq} confirmed COVID-19 cases`

        return title + this.perCapitaTitle(params.metricName)
    }

    @computed private get weekSubtitle() {
        const params = this.constrainedParams
        const metric = params.deathsMetric
            ? MetricOptions.deaths
            : MetricOptions.cases

        if (params.interval === IntervalOptions.weekly)
            return `Weekly confirmed ${metric} refer to the cumulative number of confirmed ${metric} over the previous week.`
        if (params.interval === IntervalOptions.biweekly)
            return `Biweekly confirmed ${metric} refer to the cumulative number of confirmed ${metric} over the previous two weeks.`
        if (params.interval === IntervalOptions.weeklyChange)
            return `The weekly growth rate on any given date measures the percentage change in number of confirmed ${metric} over the last seven days relative to the number in the previous seven days.`
        if (params.interval === IntervalOptions.biweeklyChange)
            return `The biweekly growth rate on any given date measures the percentage change in the number of new confirmed ${metric} over the last 14 days relative to the number in the previous 14 days.`

        return ""
    }

    @computed private get subtitle() {
        const params = this.constrainedParams
        if (params.isWeekly || params.isBiweekly) return this.weekSubtitle

        const smoothing = params.smoothing
            ? `Shown is the rolling ${params.smoothing}-day average. `
            : ""
        return `${smoothing}${
            this.yColumns.map((col) => col.def.description).join(" ") || ""
        }`
    }

    @computed private get note() {
        const params = this.constrainedParams
        if (params.testsMetric)
            return "For testing figures, there are substantial differences across countries in terms of the units, whether or not all labs are included, the extent to which negative and pending tests are included and other aspects. Details for each country can be found on ourworldindata.org/covid-testing."
        return ""
    }

    private _countryNameToColorMapCache: {
        [entityName: string]: Color | undefined
    } = {}

    @computed private get countryNameToColorMap(): {
        [entityName: string]: Color | undefined
    } {
        const names = this.tableForSelection.selectedEntityNames
        // If there isn't a color for every country name, we will need to update the color map
        if (names.every((name) => name in this._countryNameToColorMapCache))
            return this._countryNameToColorMapCache

        // Omit any unselected country names from color map
        const newColorMap = pick(this._countryNameToColorMapCache, names)
        // Check for name *key* existence, not value.
        // `undefined` value means we want the color to be automatic, determined by the chart.
        const namesWithoutColor = names.filter((name) => !(name in newColorMap))
        // For names that don't have a color, assign one.
        namesWithoutColor.forEach((name) => {
            const scheme = ColorSchemes["owid-distinct"]
            const availableColors = lastOfNonEmptyArray(scheme.colorSets)
            const usedColors = Object.values(newColorMap).filter(isPresent)
            newColorMap[name] = getLeastUsedColor(availableColors, usedColors)
        })
        // Update the country color map cache
        this._countryNameToColorMapCache = newColorMap

        return this._countryNameToColorMapCache
    }

    private renderControlsThenUpdateGrapher() {
        // Updating the chart may take a second so render the Data Explorer controls immediately then the chart.
        setTimeout(() => {
            this.updateGrapher()
        }, 1)
    }

    private inputTable = MegaCsvToCovidExplorerTable(
        this.props.megaCsv
    ).loadColumnDefTemplatesFromGrapherBackend(
        this.props.covidChartAndVariableMeta.variables
    )

    private _expandedTable?: CovidExplorerTable
    // This is the inputTable with the addition of any columns the user has added.
    @computed private get expandedTable() {
        const params = this.constrainedParams
        const table = this._expandedTable ?? this.inputTable

        const defs: CoreColumnDef[] = [...CovidAnnotationColumnDefs]

        // Add column for epi color strategy if needed
        if (params.colorStrategy === ColorScaleOptions.ptr) {
            table
                .makeShortTermPositivityRateColumnDefs()
                .forEach((def) => defs.push(def))
            this.shortTermPositivityRateSlug = last(defs)!.slug
        }

        // Add user selected columns
        this.props.params.constrainedParamsForEachMetric.forEach((params) => {
            table
                .makeColumnDefsFromParams(params)
                .forEach((def) => defs.push(def))
        })

        // Add columns for datatable
        if (params.tableMetrics)
            table
                .makeColumnDefsForDataTable(params)
                .forEach((def) => defs.push(def))

        // Cache the expanded table and add on to that if the user selects new columns, to save from recomputing current columns.
        this._expandedTable = table.appendColumnsIfNew(defs)
        return this._expandedTable
    }

    @computed private get canDoLogScale() {
        if (
            this.constrainedParams.positiveTestRate ||
            this.constrainedParams.cfrMetric ||
            (this.constrainedParams.intervalChange &&
                this.constrainedParams.intervalChange > 1)
        )
            return false
        return true
    }

    private switchBackToLog = false

    @computed private get filteredTable() {
        const params = this.constrainedParams
        let table = this.expandedTable
        const shouldFilterNegatives =
            (params.casesMetric || params.deathsMetric) &&
            !(params.interval === IntervalOptions.total) &&
            !params.intervalChange

        const shouldFilterGroups =
            (params.casesMetric || params.deathsMetric) &&
            !(params.interval === IntervalOptions.total) &&
            !params.intervalChange

        if (shouldFilterNegatives)
            table = table.filterNegatives(params.yColumnSlugs[0])
        if (shouldFilterGroups) table = table.filterGroups()
        return table
    }

    @computed private get sourceChartId(): number {
        return (sourceChartsForChartTemplates as any)[
            this.constrainedParams.sourceChartKey
        ]
    }

    @computed private get sourceChart(): GrapherInterface | undefined {
        return this.props.covidChartAndVariableMeta.charts[this.sourceChartId]
    }

    private updateMapSettings() {
        const map = this.grapher.map
        const region = map.projection

        Object.assign(map, this.sourceChart?.map || this.defaultMapConfig)

        map.time = undefined
        map.columnSlug = this.yColumn.slug

        // Preserve region
        if (region) map.projection = region
    }

    componentDidMount() {
        if (this.props.bindToWindow) this.bindToWindow()
        this.grapher = this.explorerRef.current!.grapherRef.current!
        const grapher = this.grapher
        // Show 'Add country' & 'Select countries' controls if the explorer controls are hidden.
        grapher.hideEntityControls = this.showExplorerControls
        grapher.externalCsvLink = covidDataPath
        grapher.bakedGrapherURL = `${BAKED_BASE_URL}/${covidDashboardSlug}`
        grapher.hideTitleAnnotation = true
        grapher.slug = covidDashboardSlug
        grapher.yAxis.removePointsOutsideDomain = true
        grapher.hasMapTab = true
        grapher.isPublished = true
        grapher.slideShow = new SlideShowController(
            allAvailableQueryStringCombos(),
            0,
            this
        )

        this.expandedTable.setSelectedEntitiesByCode(
            Array.from(this.props.params.selectedCountryCodes.values())
        )
        this.updateGrapher()
        this.observeGlobalEntitySelection()
        exposeInstanceOnWindow(this, "covidExplorer")
    }

    private observeGlobalEntitySelection() {
        const { globalEntitySelection } = this.props
        if (!globalEntitySelection) return

        this.disposers.push(
            reaction(
                () => [
                    globalEntitySelection.mode,
                    globalEntitySelection.selectedEntities,
                ],
                () => {
                    const { mode, selectedEntities } = globalEntitySelection
                    if (mode === GlobalEntitySelectionModes.override) {
                        this.props.params.selectedCountryCodes = new Set(
                            selectedEntities.map((entity) => entity.code)
                        )
                        this.renderControlsThenUpdateGrapher()
                    }
                },
                { fireImmediately: true }
            )
        )
    }

    bindToWindow() {
        const url = new MultipleUrlBinder([this.grapher, this])
        new UrlBinder().bindToWindow(url)
    }

    @computed get params() {
        return this.props.params.toQueryParams
    }

    disposers: (IReactionDisposer | Lambda)[] = []

    @bind dispose() {
        this.disposers.forEach((dispose) => dispose())
    }

    @computed private get yColumn() {
        return this.yColumns[0]
    }

    @computed private get yColumns() {
        return this.expandedTable
            .getColumns(this.constrainedParams.yColumnSlugs)
            .filter(isPresent)
    }

    @computed private get xColumn() {
        return this.constrainedParams.xColumnSlug
            ? this.expandedTable.get(this.constrainedParams.xColumnSlug!)!
            : undefined
    }

    @computed private get sizeColumn() {
        return this.constrainedParams.sizeColumn
            ? this.expandedTable.get(this.constrainedParams.sizeColumn!)!
            : undefined
    }

    @computed private get yDimensions(): LegacyChartDimensionInterface[] {
        return this.yColumns.map((col, index) => {
            return {
                property: DimensionProperty.y,
                slug: col.slug,
                variableId: index,
                display: {
                    tolerance: col.def.display?.tolerance ?? 10,
                },
            }
        })
    }

    @computed private get xDimension(): LegacyChartDimensionInterface {
        const xColumn = this.xColumn!
        return {
            property: DimensionProperty.x,
            slug: xColumn.slug,
            variableId: 0,
        }
    }

    @computed private get legacyDimensions(): LegacyChartDimensionInterface[] {
        if (this.constrainedParams.type !== ChartTypeName.ScatterPlot)
            return this.yDimensions

        const dimensions = [...this.yDimensions, this.xDimension]

        if (this.constrainedParams.colorStrategy !== ColorScaleOptions.none)
            dimensions.push(this.colorDimension)
        if (this.sizeColumn) dimensions.push(this.sizeDimension)
        return dimensions
    }

    @computed private get sizeDimension(): LegacyChartDimensionInterface {
        return {
            property: DimensionProperty.size,
            slug: this.sizeColumn?.slug,
            variableId: 0,
        }
    }

    private shortTermPositivityRateSlug = ""
    @computed private get colorDimension(): LegacyChartDimensionInterface {
        const slug =
            this.constrainedParams.colorStrategy ===
            ColorScaleOptions.continents
                ? ColorScaleOptions.continents
                : this.shortTermPositivityRateSlug

        return {
            property: DimensionProperty.color,
            slug,
            variableId: 0,
            display: {
                tolerance: 10,
            },
        }
    }

    @computed private get colorScales(): {
        [name: string]: ColorScaleConfigInterface
    } {
        return {
            ptr: this.props.covidChartAndVariableMeta.charts[
                sourceChartsForChartTemplates.epi
            ]?.colorScale as any,
            continents: {
                binningStrategy: BinningStrategy.manual,
                legendDescription: "Continent",
                baseColorScheme: undefined,
                customNumericValues: [],
                customNumericLabels: [],
                customNumericColors: [],
                customCategoryColors: ContinentColors,
                customCategoryLabels: {
                    "No data": "Other",
                },
                customHiddenCategories: {},
            },
            none: {
                binningStrategy: BinningStrategy.manual,
                legendDescription: "",
                baseColorScheme: undefined,
                customNumericValues: [],
                customNumericLabels: [],
                customNumericColors: [],
                customCategoryColors: ContinentColors,
                customCategoryLabels: {
                    "No data": "",
                },
                customHiddenCategories: {},
            },
        }
    }

    private defaultMapConfig() {
        return {
            columnSlug: ColorScaleOptions.continents,
            timeTolerance: 7,
            projection: MapProjectionName.World,
            colorScale: {
                colorSchemeValues: [],
                colorSchemeLabels: [],
                customNumericColors: [],
                customCategoryColors: {},
                customCategoryLabels: {},
                customHiddenCategories: {},
            },
        }
    }

    @observable.ref grapher = new Grapher()

    @action.bound setSlide(queryString: string) {
        this.props.params.setParamsFromQueryString(queryString)
        this.updateGrapher()
    }

    // We can't create a new chart object with every radio change because the Chart component itself
    // maintains state (for example, which tab is currently active). Temporary workaround is just to
    // manually update the chart when the chart builderselections change.
    // todo: cleanup
    @action.bound private updateGrapher() {
        const params = this.constrainedParams
        const { grapher, filteredTable } = this
        grapher.title = this.chartTitle
        grapher.subtitle = this.subtitle
        grapher.note = this.note

        // If we switch to scatter, set zoomToSelection to true. I don't set it to true initially in the chart
        // config because then it won't appear in the URL.
        if (
            grapher.type === ChartTypeName.LineChart &&
            params.type === ChartTypeName.ScatterPlot
        )
            grapher.zoomToSelection = true

        grapher.type = params.type
        grapher.yAxis.label = ""

        if (!this.canDoLogScale) {
            this.switchBackToLog = grapher.yAxis.scaleType === ScaleType.log
            grapher.yAxis.scaleType = ScaleType.linear
            grapher.yAxis.canChangeScaleType = undefined
        } else {
            grapher.yAxis.canChangeScaleType = true
            if (this.switchBackToLog) {
                grapher.yAxis.scaleType = ScaleType.log
                this.switchBackToLog = false
            }
        }

        grapher.inputTable = filteredTable
        grapher.yAxis.min = params.intervalChange ? undefined : 0
        grapher.setDimensionsFromConfigs(this.legacyDimensions)

        if (this.constrainedParams.yColumnSlugs.length > 1 && !grapher.facet)
            grapher.facet = FacetStrategy.column

        this.updateMapSettings()

        grapher.colorScale.updateFromObject(
            this.colorScales[params.colorStrategy]
        )

        grapher.dataTableColumnSlugsToShow = filteredTable.columnSlugsToShowInDataTable(
            params
        )

        grapher.id = this.sourceChartId
        grapher.baseQueryString = queryParamsToStr(
            this.props.params.toQueryParams
        )
    }
}
