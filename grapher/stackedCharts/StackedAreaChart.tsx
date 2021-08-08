import * as React from "react"
import {
    reverse,
    clone,
    last,
    pointsToPath,
    getRelativeMouse,
    makeSafeForCSS,
    minBy,
} from "../../clientUtils/Util"
import { computed, action, observable } from "mobx"
import { SeriesName } from "../core/GrapherConstants"
import { observer } from "mobx-react"
import { DualAxisComponent } from "../axis/AxisViews"
import { DualAxis, VerticalAxis } from "../axis/Axis"
import {
    LineLabelSeries,
    LineLegend,
    LineLegendManager,
} from "../lineLegend/LineLegend"
import { NoDataModal } from "../noDataModal/NoDataModal"
import { Tooltip } from "../tooltip/Tooltip"
import { rgb } from "d3-color"
import {
    AbstactStackedChart,
    AbstactStackedChartProps,
} from "../stackedCharts/AbstractStackedChart"
import { StackedSeries } from "./StackedConstants"
import { stackSeries, withMissingValuesAsZeroes } from "./StackedUtils"
import { makeClipPath } from "../chart/ChartUtils"
import { Time } from "../../clientUtils/owidTypes"

interface AreasProps extends React.SVGAttributes<SVGGElement> {
    dualAxis: DualAxis
    seriesArr: readonly StackedSeries<Time>[]
    focusedSeriesNames: SeriesName[]
    onHover: (hoverIndex: number | undefined) => void
}

const BLUR_COLOR = "#ddd"

@observer
class Areas extends React.Component<AreasProps> {
    base: React.RefObject<SVGGElement> = React.createRef()

    @observable hoverIndex?: number

    @action.bound private onCursorMove(
        ev: React.MouseEvent<SVGGElement> | React.TouchEvent<SVGElement>
    ): void {
        const { dualAxis, seriesArr } = this.props

        if (this.base.current) {
            const mouse = getRelativeMouse(this.base.current, ev.nativeEvent)

            if (dualAxis.innerBounds.contains(mouse)) {
                const closestPoint = minBy(seriesArr[0].points, (d) =>
                    Math.abs(
                        dualAxis.horizontalAxis.place(d.position) - mouse.x
                    )
                )
                if (closestPoint) {
                    const index = seriesArr[0].points.indexOf(closestPoint)
                    this.hoverIndex = index
                } else {
                    this.hoverIndex = undefined
                }
            } else {
                this.hoverIndex = undefined
            }

            this.props.onHover(this.hoverIndex)
        }
    }

    @action.bound private onCursorLeave(): void {
        this.hoverIndex = undefined
        this.props.onHover(this.hoverIndex)
    }

    private seriesIsBlur(series: StackedSeries<Time>): boolean {
        return (
            this.props.focusedSeriesNames.length > 0 &&
            !this.props.focusedSeriesNames.includes(series.seriesName)
        )
    }

    @computed private get areas(): JSX.Element[] {
        const { dualAxis, seriesArr } = this.props
        const { horizontalAxis, verticalAxis } = dualAxis
        const xBottomLeft = [horizontalAxis.range[0], verticalAxis.range[0]]
        const xBottomRight = [horizontalAxis.range[1], verticalAxis.range[0]]

        // Stacked area chart stacks each series upon the previous series, so we must keep track of the last point set we used
        let prevPoints = [xBottomLeft, xBottomRight]
        return seriesArr.map((series) => {
            const mainPoints = series.points.map(
                (point) =>
                    [
                        horizontalAxis.place(point.position),
                        verticalAxis.place(point.value + point.valueOffset),
                    ] as [number, number]
            )
            const points = mainPoints.concat(reverse(clone(prevPoints)) as any)
            prevPoints = mainPoints

            return (
                <path
                    className={makeSafeForCSS(series.seriesName) + "-area"}
                    key={series.seriesName + "-area"}
                    strokeLinecap="round"
                    d={pointsToPath(points)}
                    fill={this.seriesIsBlur(series) ? BLUR_COLOR : series.color}
                    fillOpacity={0.7}
                    clipPath={this.props.clipPath}
                />
            )
        })
    }

    @computed private get borders(): JSX.Element[] {
        const { dualAxis, seriesArr } = this.props
        const { horizontalAxis, verticalAxis } = dualAxis

        // Stacked area chart stacks each series upon the previous series, so we must keep track of the last point set we used
        return seriesArr.map((series) => {
            const points = series.points.map(
                (point) =>
                    [
                        horizontalAxis.place(point.position),
                        verticalAxis.place(point.value + point.valueOffset),
                    ] as [number, number]
            )

            return (
                <path
                    className={makeSafeForCSS(series.seriesName) + "-border"}
                    key={series.seriesName + "-border"}
                    strokeLinecap="round"
                    d={pointsToPath(points)}
                    stroke={rgb(
                        this.seriesIsBlur(series) ? BLUR_COLOR : series.color
                    )
                        .darker(0.5)
                        .toString()}
                    strokeOpacity={0.7}
                    strokeWidth={0.5}
                    fill="none"
                    clipPath={this.props.clipPath}
                />
            )
        })
    }

    render(): JSX.Element {
        const { dualAxis, seriesArr } = this.props
        const { horizontalAxis, verticalAxis } = dualAxis
        const { hoverIndex } = this

        return (
            <g
                ref={this.base}
                className="Areas"
                onMouseMove={this.onCursorMove}
                onMouseLeave={this.onCursorLeave}
                onTouchStart={this.onCursorMove}
                onTouchMove={this.onCursorMove}
                onTouchEnd={this.onCursorLeave}
                onTouchCancel={this.onCursorLeave}
            >
                <rect
                    x={horizontalAxis.range[0]}
                    y={verticalAxis.range[1]}
                    width={horizontalAxis.range[1] - horizontalAxis.range[0]}
                    height={verticalAxis.range[0] - verticalAxis.range[1]}
                    opacity={0}
                    fill="rgba(255,255,255,0)"
                />
                {this.areas}
                {this.borders}
                {hoverIndex !== undefined && (
                    <g className="hoverIndicator">
                        {seriesArr.map((series) => {
                            const point = series.points[hoverIndex]
                            return this.seriesIsBlur(series) ||
                                point.fake ? null : (
                                <circle
                                    key={series.seriesName}
                                    cx={horizontalAxis.place(point.position)}
                                    cy={verticalAxis.place(
                                        point.value + point.valueOffset
                                    )}
                                    r={2}
                                    fill={series.color}
                                />
                            )
                        })}
                        <line
                            x1={horizontalAxis.place(
                                seriesArr[0].points[hoverIndex].position
                            )}
                            y1={verticalAxis.range[0]}
                            x2={horizontalAxis.place(
                                seriesArr[0].points[hoverIndex].position
                            )}
                            y2={verticalAxis.range[1]}
                            stroke="rgba(180,180,180,.4)"
                        />
                    </g>
                )}
            </g>
        )
    }
}

@observer
export class StackedAreaChart
    extends AbstactStackedChart<Time>
    implements LineLegendManager {
    constructor(props: AbstactStackedChartProps) {
        super(props)
    }

    @computed get midpoints(): number[] {
        let prevY = 0
        return this.series.map((series) => {
            const lastValue = last(series.points)
            if (!lastValue) return 0

            const y = lastValue.value + lastValue.valueOffset
            const middleY = prevY + (y - prevY) / 2
            prevY = y
            return middleY
        })
    }

    @computed get labelSeries(): LineLabelSeries[] {
        const { midpoints } = this
        return this.series
            .map((series, index) => ({
                color: series.color,
                seriesName: series.seriesName,
                label: series.seriesName,
                yValue: midpoints[index],
            }))
            .reverse()
    }

    @computed get maxLegendWidth(): number {
        return Math.min(150, this.bounds.width / 3)
    }

    @computed get legendDimensions(): LineLegend | undefined {
        if (this.manager.hideLegend) return undefined
        return new LineLegend({ manager: this })
    }

    @observable hoveredPointIndex?: number
    @action.bound onHover(hoverIndex: number | undefined): void {
        this.hoveredPointIndex = hoverIndex
    }

    @observable hoverSeriesName?: SeriesName
    @action.bound onLegendClick(): void {
        if (this.manager.startSelectingWhenLineClicked)
            this.manager.isSelectingData = true
    }

    @computed protected get paddingForLegend(): number {
        const { legendDimensions } = this
        return legendDimensions ? legendDimensions.width : 20
    }

    @action.bound onLegendMouseOver(seriesName: SeriesName): void {
        this.hoverSeriesName = seriesName
    }

    @action.bound onLegendMouseLeave(): void {
        this.hoverSeriesName = undefined
    }

    @computed get focusedSeriesNames(): string[] {
        return this.hoverSeriesName ? [this.hoverSeriesName] : []
    }

    @computed get isFocusMode(): boolean {
        return this.focusedSeriesNames.length > 0
    }

    seriesIsBlur(series: StackedSeries<Time>): boolean {
        return (
            this.focusedSeriesNames.length > 0 &&
            !this.focusedSeriesNames.includes(series.seriesName)
        )
    }

    @computed private get tooltip(): JSX.Element | undefined {
        if (this.hoveredPointIndex === undefined) return undefined

        const { hoveredPointIndex, dualAxis, series } = this

        // Grab the first value to get the year from
        const bottomSeriesPoint = series[0].points[hoveredPointIndex]

        // If some data is missing, don't calculate a total
        const somePointsMissingForHoveredTime = series.some(
            (series) => series.points[hoveredPointIndex].fake
        )

        const legendBlockStyle = {
            width: "10px",
            height: "10px",
            display: "inline-block",
            marginRight: "2px",
        }

        const lastStackedPoint = last(series)!.points[hoveredPointIndex]
        const totalValue = lastStackedPoint.value + lastStackedPoint.valueOffset

        const yColumn = this.yColumns[0] // Assumes same type for all columns.

        return (
            <Tooltip
                tooltipManager={this.props.manager}
                x={dualAxis.horizontalAxis.place(bottomSeriesPoint.position)}
                y={
                    dualAxis.verticalAxis.rangeMin +
                    dualAxis.verticalAxis.rangeSize / 2
                }
                style={{ padding: "0.3em" }}
                offsetX={5}
            >
                <table style={{ fontSize: "0.9em", lineHeight: "1.4em" }}>
                    <tbody>
                        <tr>
                            <td>
                                <strong>
                                    {this.inputTable.timeColumnFormatFunction(
                                        bottomSeriesPoint.position
                                    )}
                                </strong>
                            </td>
                            <td></td>
                        </tr>
                        {series
                            .slice()
                            .reverse()
                            .map((series) => {
                                const point = series.points[hoveredPointIndex]
                                const isBlur = this.seriesIsBlur(series)
                                const textColor = isBlur ? "#ddd" : "#333"
                                const blockColor = isBlur
                                    ? BLUR_COLOR
                                    : series.color
                                return (
                                    <tr
                                        key={series.seriesName}
                                        style={{ color: textColor }}
                                    >
                                        <td
                                            style={{
                                                paddingRight: "0.8em",
                                                fontSize: "0.9em",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    ...legendBlockStyle,
                                                    backgroundColor: blockColor,
                                                }}
                                            />{" "}
                                            {series.seriesName}
                                        </td>
                                        <td style={{ textAlign: "right" }}>
                                            {point.fake
                                                ? "No data"
                                                : yColumn.formatValueLong(
                                                      point.value
                                                  )}
                                        </td>
                                    </tr>
                                )
                            })}
                        {/* Total */}
                        {!somePointsMissingForHoveredTime && (
                            <tr>
                                <td style={{ fontSize: "0.9em" }}>
                                    <div
                                        style={{
                                            ...legendBlockStyle,
                                            backgroundColor: "transparent",
                                        }}
                                    />{" "}
                                    <strong>Total</strong>
                                </td>
                                <td style={{ textAlign: "right" }}>
                                    <span>
                                        <strong>
                                            {yColumn.formatValueLong(
                                                totalValue
                                            )}
                                        </strong>
                                    </span>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </Tooltip>
        )
    }

    render(): JSX.Element {
        if (this.failMessage)
            return (
                <NoDataModal
                    manager={this.manager}
                    bounds={this.props.bounds}
                    message={this.failMessage}
                />
            )

        const { bounds, dualAxis, renderUid, series } = this

        const showLegend = !this.manager.hideLegend

        const clipPath = makeClipPath(renderUid, {
            ...bounds,
            height: bounds.height * 2,
            x: dualAxis.innerBounds.x,
        })

        return (
            <g ref={this.base} className="StackedArea">
                {clipPath.element}
                <DualAxisComponent dualAxis={dualAxis} showTickMarks={true} />
                <g clipPath={clipPath.id}>
                    {showLegend && <LineLegend manager={this} />}
                    <Areas
                        dualAxis={dualAxis}
                        seriesArr={series}
                        focusedSeriesNames={this.focusedSeriesNames}
                        onHover={this.onHover}
                    />
                </g>
                {this.tooltip}
            </g>
        )
    }
    /** Whether we want to display series with only zeroes (inherited). False for this class, true for others */
    get showAllZeroSeries() {
        return false
    }

    @computed get legendX(): number {
        return this.legendDimensions
            ? this.bounds.right - this.legendDimensions.width
            : 0
    }

    @computed get series(): readonly StackedSeries<number>[] {
        return stackSeries(withMissingValuesAsZeroes(this.unstackedSeries))
    }
}
