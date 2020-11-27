import * as React from "react"
import { observable, computed, action } from "mobx"
import { observer } from "mobx-react"
import { ChartEditor } from "./ChartEditor"
import { Grapher } from "grapher/core/Grapher"
import { ComparisonLineConfig } from "grapher/scatterCharts/ComparisonLine"
import {
    NumberField,
    Toggle,
    FieldsRow,
    Section,
    BindAutoString,
    BindString,
    TextField,
    Button,
} from "./Forms"
import { debounce } from "clientUtils/Util"
import { faPlus } from "@fortawesome/free-solid-svg-icons/faPlus"
import { faMinus } from "@fortawesome/free-solid-svg-icons/faMinus"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { ColorSchemeDropdown, ColorSchemeOption } from "./ColorSchemeDropdown"
import { EditorColorScaleSection } from "./EditorColorScaleSection"
import { ColorSchemeName } from "grapher/color/ColorConstants"
import { TimeBoundValue } from "clientUtils/TimeBounds"
import { GrapherTabOption } from "grapher/core/GrapherConstants"

@observer
class ColorSchemeSelector extends React.Component<{ grapher: Grapher }> {
    @action.bound onChange(selected: ColorSchemeOption) {
        // The onChange method can return an array of values (when multiple
        // items can be selected) or a single value. Since we are certain that
        // we are not using the multi-option select we can force the type to be
        // a single value.

        this.props.grapher.baseColorScheme = (selected.value === "default"
            ? undefined
            : selected.value) as ColorSchemeName

        // clear out saved, pre-computed colors so the color scheme change is immediately visible
        this.props.grapher.seriesColorMap?.clear()
    }

    @action.bound onInvertColorScheme(value: boolean) {
        this.props.grapher.invertColorScheme = value || undefined

        this.props.grapher.seriesColorMap?.clear()
    }

    render() {
        const { grapher } = this.props

        return (
            <React.Fragment>
                <FieldsRow>
                    <div className="form-group">
                        <label>Color scheme</label>
                        <ColorSchemeDropdown
                            value={grapher.baseColorScheme || "default"}
                            onChange={this.onChange}
                            invertedColorScheme={!!grapher.invertColorScheme}
                            additionalOptions={[
                                {
                                    colorScheme: undefined,
                                    gradient: undefined,
                                    label: "Default",
                                    value: "default",
                                },
                            ]}
                        />
                    </div>
                </FieldsRow>
                <FieldsRow>
                    <Toggle
                        label="Invert colors"
                        value={!!grapher.invertColorScheme}
                        onValue={this.onInvertColorScheme}
                    />
                </FieldsRow>
            </React.Fragment>
        )
    }
}

@observer
class TimelineSection extends React.Component<{ editor: ChartEditor }> {
    base: React.RefObject<HTMLDivElement> = React.createRef()

    @computed get grapher() {
        return this.props.editor.grapher
    }

    @computed get minTime() {
        return this.grapher.minTime
    }
    @computed get maxTime() {
        return this.grapher.maxTime
    }

    @computed get timelineMinTime() {
        return this.grapher.timelineMinTime
    }
    @computed get timelineMaxTime() {
        return this.grapher.timelineMaxTime
    }

    @action.bound onMinTime(value: number | undefined) {
        this.grapher.startHandleTimeBound =
            value ?? TimeBoundValue.negativeInfinity
    }

    @action.bound onMaxTime(value: number | undefined) {
        this.grapher.endHandleTimeBound =
            value ?? TimeBoundValue.positiveInfinity
    }

    @action.bound onTimelineMinTime(value: number | undefined) {
        this.grapher.timelineMinTime = value
    }

    @action.bound onTimelineMaxTime(value: number | undefined) {
        this.grapher.timelineMaxTime = value
    }

    @action.bound onToggleHideTimeline(value: boolean) {
        this.grapher.hideTimeline = value || undefined
    }

    @action.bound onToggleShowYearLabels(value: boolean) {
        this.grapher.showYearLabels = value || undefined
    }

    render() {
        const { features } = this.props.editor
        const { grapher } = this

        return (
            <Section name="Timeline selection">
                <FieldsRow>
                    {features.timeDomain && (
                        <NumberField
                            label="Selection start"
                            value={grapher.minTime}
                            onValue={debounce(this.onMinTime)}
                            allowNegative
                        />
                    )}
                    <NumberField
                        label={
                            features.timeDomain
                                ? "Selection end"
                                : "Selected year"
                        }
                        value={grapher.maxTime}
                        onValue={debounce(this.onMaxTime)}
                        allowNegative
                    />
                </FieldsRow>
                {features.timelineRange && (
                    <FieldsRow>
                        <NumberField
                            label="Timeline min"
                            value={this.timelineMinTime}
                            onValue={debounce(this.onTimelineMinTime)}
                            allowNegative
                        />
                        <NumberField
                            label="Timeline max"
                            value={this.timelineMaxTime}
                            onValue={debounce(this.onTimelineMaxTime)}
                            allowNegative
                        />
                    </FieldsRow>
                )}
                <FieldsRow>
                    <Toggle
                        label="Hide timeline"
                        value={!!grapher.hideTimeline}
                        onValue={this.onToggleHideTimeline}
                    />
                    {features.showYearLabels && (
                        <Toggle
                            label="Always show year labels"
                            value={!!grapher.showYearLabels}
                            onValue={this.onToggleShowYearLabels}
                        />
                    )}
                </FieldsRow>
            </Section>
        )
    }
}

@observer
class ComparisonLineSection extends React.Component<{ editor: ChartEditor }> {
    @observable comparisonLines: ComparisonLineConfig[] = []

    @action.bound onAddComparisonLine() {
        const { grapher } = this.props.editor
        grapher.comparisonLines.push({})
    }

    @action.bound onRemoveComparisonLine(index: number) {
        const { grapher } = this.props.editor
        grapher.comparisonLines!.splice(index, 1)
    }

    render() {
        const { comparisonLines } = this.props.editor.grapher

        return (
            <Section name="Comparison line">
                <p>
                    Overlay a line onto the chart for comparison. Supports basic{" "}
                    <a href="https://github.com/silentmatt/expr-eval#expression-syntax">
                        mathematical expressions
                    </a>
                    .
                </p>

                <Button onClick={this.onAddComparisonLine}>
                    <FontAwesomeIcon icon={faPlus} /> Add comparison line
                </Button>
                {comparisonLines.map((comparisonLine, i) => (
                    <div key={i}>
                        {`Line ${i + 1}`}{" "}
                        <Button onClick={() => this.onRemoveComparisonLine(i)}>
                            <FontAwesomeIcon icon={faMinus} />
                        </Button>
                        <TextField
                            label={`y=`}
                            placeholder="x"
                            value={comparisonLine.yEquals}
                            onValue={action((value: string) => {
                                comparisonLine.yEquals = value || undefined
                            })}
                        />
                        <TextField
                            label="Label"
                            value={comparisonLine.label}
                            onValue={action((value: string) => {
                                comparisonLine.label = value || undefined
                            })}
                        />
                    </div>
                ))}
            </Section>
        )
    }
}

@observer
export class EditorCustomizeTab extends React.Component<{
    editor: ChartEditor
}> {
    render() {
        const xAxisConfig = this.props.editor.grapher.xAxis
        const yAxisConfig = this.props.editor.grapher.yAxis

        const { features } = this.props.editor
        const { grapher } = this.props.editor

        return (
            <div>
                {features.canCustomizeYAxis && (
                    <Section name="Y Axis">
                        {features.canCustomizeYAxisScale && (
                            <React.Fragment>
                                <FieldsRow>
                                    <NumberField
                                        label={`Min`}
                                        value={yAxisConfig.min}
                                        onValue={(value) =>
                                            (yAxisConfig.min = value)
                                        }
                                        allowDecimal
                                        allowNegative
                                    />
                                    <NumberField
                                        label={`Max`}
                                        value={yAxisConfig.max}
                                        onValue={(value) =>
                                            (yAxisConfig.max = value)
                                        }
                                        allowDecimal
                                        allowNegative
                                    />
                                </FieldsRow>
                                {features.canRemovePointsOutsideAxisDomain && (
                                    <FieldsRow>
                                        <Toggle
                                            label={`Remove points outside domain`}
                                            value={
                                                yAxisConfig.removePointsOutsideDomain ||
                                                false
                                            }
                                            onValue={(value) =>
                                                (yAxisConfig.removePointsOutsideDomain =
                                                    value || undefined)
                                            }
                                        />
                                    </FieldsRow>
                                )}
                                <FieldsRow>
                                    <Toggle
                                        label={`Enable log/linear selector`}
                                        value={
                                            yAxisConfig.canChangeScaleType ||
                                            false
                                        }
                                        onValue={(value) =>
                                            (yAxisConfig.canChangeScaleType =
                                                value || undefined)
                                        }
                                    />
                                </FieldsRow>
                            </React.Fragment>
                        )}
                        {features.canCustomizeYAxisLabel && (
                            <BindString
                                label="Label"
                                field="label"
                                store={yAxisConfig}
                            />
                        )}
                    </Section>
                )}
                {features.canCustomizeXAxis && (
                    <Section name="X Axis">
                        {features.canCustomizeXAxisScale && (
                            <React.Fragment>
                                <FieldsRow>
                                    <NumberField
                                        label={`Min`}
                                        value={xAxisConfig.min}
                                        onValue={(value) =>
                                            (xAxisConfig.min = value)
                                        }
                                        allowDecimal
                                        allowNegative
                                    />
                                    <NumberField
                                        label={`Max`}
                                        value={xAxisConfig.max}
                                        onValue={(value) =>
                                            (xAxisConfig.max = value)
                                        }
                                        allowDecimal
                                        allowNegative
                                    />
                                </FieldsRow>
                                {features.canRemovePointsOutsideAxisDomain && (
                                    <FieldsRow>
                                        <Toggle
                                            label={`Remove points outside domain`}
                                            value={
                                                xAxisConfig.removePointsOutsideDomain ||
                                                false
                                            }
                                            onValue={(value) =>
                                                (xAxisConfig.removePointsOutsideDomain =
                                                    value || undefined)
                                            }
                                        />
                                    </FieldsRow>
                                )}
                                <FieldsRow>
                                    <Toggle
                                        label={`Enable log/linear selector`}
                                        value={
                                            xAxisConfig.canChangeScaleType ||
                                            false
                                        }
                                        onValue={(value) =>
                                            (xAxisConfig.canChangeScaleType =
                                                value || undefined)
                                        }
                                    />
                                </FieldsRow>
                            </React.Fragment>
                        )}
                        {features.canCustomizeXAxisLabel && (
                            <BindString
                                label="Label"
                                field="label"
                                store={xAxisConfig}
                            />
                        )}
                    </Section>
                )}
                <TimelineSection editor={this.props.editor} />
                <Section name="Color scheme">
                    <ColorSchemeSelector grapher={grapher} />
                </Section>
                {grapher.tab != GrapherTabOption.map && // Map color scale config is in EditorMapTab
                    grapher.activeColorScale && (
                        <EditorColorScaleSection
                            scale={grapher.activeColorScale}
                            features={{
                                visualScaling: false,
                                legendDescription:
                                    grapher.isScatter ||
                                    grapher.isSlopeChart ||
                                    grapher.isStackedBar,
                            }}
                        />
                    )}
                {(features.hideLegend || features.entityType) && (
                    <Section name="Legend">
                        <FieldsRow>
                            {features.hideLegend && (
                                <Toggle
                                    label={`Hide legend`}
                                    value={!!grapher.hideLegend}
                                    onValue={(value) =>
                                        (grapher.hideLegend =
                                            value || undefined)
                                    }
                                />
                            )}
                        </FieldsRow>
                        {features.entityType && (
                            <BindAutoString
                                label="Entity name"
                                field="entityType"
                                store={grapher}
                                auto="country"
                            />
                        )}
                    </Section>
                )}
                {features.relativeModeToggle && (
                    <Section name="Controls">
                        <FieldsRow>
                            <Toggle
                                label={`Hide relative toggle`}
                                value={!!grapher.hideRelativeToggle}
                                onValue={(value) =>
                                    (grapher.hideRelativeToggle =
                                        value || false)
                                }
                            />
                        </FieldsRow>
                    </Section>
                )}
                {features.comparisonLine && (
                    <ComparisonLineSection editor={this.props.editor} />
                )}
            </div>
        )
    }
}
