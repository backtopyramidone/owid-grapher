import { line as d3_line, curveLinear } from "d3-shape"
import { guid } from "../../clientUtils/Util"
import * as React from "react"
import { computed } from "mobx"
import { observer } from "mobx-react"
import { DualAxis } from "../axis/Axis"
import { generateComparisonLinePoints } from "./ComparisonLineGenerator"
import { Bounds } from "../../clientUtils/Bounds"
import { PointVector } from "../../clientUtils/PointVector"
import { getElementWithHalo } from "./Halos"

export interface ComparisonLineConfig {
    label?: string
    yEquals?: string
}

@observer
export class ComparisonLine extends React.Component<{
    dualAxis: DualAxis
    comparisonLine: ComparisonLineConfig
}> {
    private renderUid = guid()

    @computed private get controlData(): [number, number][] {
        const { comparisonLine, dualAxis } = this.props
        const { horizontalAxis, verticalAxis } = dualAxis
        return generateComparisonLinePoints(
            comparisonLine.yEquals,
            horizontalAxis.domain,
            verticalAxis.domain,
            horizontalAxis.scaleType,
            verticalAxis.scaleType
        )
    }

    @computed private get linePath(): string | null {
        const { controlData } = this
        const { horizontalAxis, verticalAxis } = this.props.dualAxis
        const line = d3_line()
            .curve(curveLinear)
            .x((d) => horizontalAxis.place(d[0]))
            .y((d) => verticalAxis.place(d[1]))
        return line(controlData)
    }

    @computed private get placedLabel():
        | { x: number; y: number; bounds: Bounds; angle: number; text: string }
        | undefined {
        const { label } = this.props.comparisonLine
        if (!label) return

        const { controlData } = this
        const {
            horizontalAxis,
            verticalAxis,
            innerBounds,
        } = this.props.dualAxis

        // Find the points of the line that are actually placeable on the chart
        const linePoints = controlData
            .map(
                (d) =>
                    new PointVector(
                        horizontalAxis.place(d[0]),
                        verticalAxis.place(d[1])
                    )
            )
            .filter((p) => innerBounds.contains(p))
        if (!linePoints.length) return

        const midPoint = linePoints[Math.floor(linePoints.length / 2)]
        const p1 = linePoints[0]
        const p2 = linePoints[linePoints.length - 1]
        const angle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI
        const bounds = Bounds.forText(label)
        return {
            x: midPoint.x,
            y: midPoint.y,
            bounds: bounds,
            angle: angle,
            text: label,
        }
    }

    render(): JSX.Element {
        const { innerBounds } = this.props.dualAxis
        const { linePath, renderUid, placedLabel } = this

        return (
            <g className="comparisonLine">
                <defs>
                    <clipPath id={`axisBounds-${renderUid}`}>
                        <rect
                            x={innerBounds.x}
                            y={innerBounds.y}
                            width={innerBounds.width}
                            height={innerBounds.height}
                        />
                    </clipPath>
                </defs>
                <path
                    style={{
                        opacity: 0.9,
                        fill: "none",
                        stroke: "#ccc",
                        strokeDasharray: "2 2",
                    }}
                    id={`path-${renderUid}`}
                    d={linePath || undefined}
                    clipPath={`url(#axisBounds-${renderUid})`}
                />
                {placedLabel && (
                    <text
                        style={{
                            fontSize: "80%",
                            opacity: 0.9,
                            textAnchor: "end",
                            fill: "#999",
                        }}
                        clipPath={`url(#axisBounds-${renderUid})`}
                    >
                        {getElementWithHalo(
                            `path-${renderUid}`,
                            <textPath
                                baselineShift="-0.2rem"
                                href={`#path-${renderUid}`}
                                startOffset="90%"
                            >
                                {placedLabel.text}
                            </textPath>
                        )}
                    </text>
                )}
            </g>
        )
    }
}
