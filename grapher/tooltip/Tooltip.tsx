import * as React from "react"
import { observable, computed, action } from "mobx"
import { observer } from "mobx-react"
import { Bounds } from "../../clientUtils/Bounds"
import { TooltipProps, TooltipManager } from "./TooltipProps"

@observer
export class TooltipView extends React.Component<{
    tooltipProvider: TooltipManager
    width: number
    height: number
}> {
    @computed private get rendered() {
        const { bounds } = this
        const tooltipProvider = this.props.tooltipProvider

        if (!tooltipProvider.tooltip) return null

        const tooltip = tooltipProvider.tooltip

        const offsetX = tooltip.offsetX ?? 0
        let offsetY = tooltip.offsetY ?? 0
        if (tooltip.offsetYDirection === "upward") {
            offsetY = -offsetY - (bounds?.height ?? 0)
        }

        let x = tooltip.x + offsetX
        let y = tooltip.y + offsetY

        // Ensure tooltip remains inside chart
        if (bounds) {
            if (x + bounds.width > this.props.width)
                x -= bounds.width + 2 * offsetX
            if (y + bounds.height > this.props.height)
                y -= bounds.height + 2 * offsetY
            if (x < 0) x = 0
            if (y < 0) y = 0
        }

        const tooltipStyle: React.CSSProperties = {
            position: "absolute",
            pointerEvents: "none",
            left: `${x}px`,
            top: `${y}px`,
            whiteSpace: "nowrap",
            backgroundColor: "rgba(255,255,255,0.92)",
            boxShadow: "0 2px 2px rgba(0,0,0,.12), 0 0 1px rgba(0,0,0,.35)",
            borderRadius: "2px",
            textAlign: "left",
            fontSize: "0.9em",
        }

        return (
            <div
                ref={this.base}
                className="Tooltip"
                style={{ ...tooltipStyle, ...tooltip.style }}
            >
                {tooltip.children}
            </div>
        )
    }

    private base: React.RefObject<HTMLDivElement> = React.createRef()

    @observable.struct private bounds?: Bounds
    @action.bound private updateBounds(): void {
        if (this.base.current)
            this.bounds = Bounds.fromElement(this.base.current)
    }

    componentDidMount(): void {
        this.updateBounds()
    }

    componentDidUpdate(): void {
        this.updateBounds()
    }

    render(): JSX.Element | null {
        return this.rendered
    }
}

@observer
export class Tooltip extends React.Component<TooltipProps> {
    componentDidMount(): void {
        this.connectTooltipToContainer()
    }

    @action.bound private connectTooltipToContainer(): void {
        this.props.tooltipManager.tooltip = this.props
    }

    @action.bound private removeToolTipFromContainer(): void {
        this.props.tooltipManager.tooltip = undefined
    }

    componentDidUpdate(): void {
        this.connectTooltipToContainer()
    }

    componentWillUnmount(): void {
        this.removeToolTipFromContainer()
    }

    render(): null {
        return null
    }
}
