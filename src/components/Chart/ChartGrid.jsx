import React, { useMemo } from 'react';
import styles from './ChartGrid.module.css';
import ChartComponent from './ChartComponent';
import { ChartErrorBoundary } from './ChartErrorBoundary';
import { BinanceLiveFeed } from '../../feeds/BinanceLiveFeed';

/**
 * ChartGrid — renders 1-4 chart panels in a CSS grid.
 *
 * Each chart receives its own BinanceLiveFeed instance so subscriptions
 * are fully isolated: switching symbol on chart-2 never drops chart-1's stream.
 */
const ChartGrid = ({
    charts,
    layout,
    activeChartId,
    onActiveChartChange,
    chartRefs,
    onAlertsSync,
    onAlertTriggered,
    onReplayModeChange,
    ...chartProps
}) => {
    const getGridClass = () => {
        switch (layout) {
            case '2': return styles.grid2;
            case '3': return styles.grid3;
            case '4': return styles.grid4;
            default: return styles.grid1;
        }
    };

    // Create stable, per-chart feed instances keyed by chart.id.
    // useMemo with the chart id list as deps means feeds survive re-renders
    // but are recreated only when the chart count/ids change.
    const feedMap = useMemo(() => {
        const map = new Map();
        for (const chart of charts) {
            map.set(chart.id, new BinanceLiveFeed(`chart-${chart.id}`));
        }
        return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [charts.map((c) => c.id).join(',')]);

    return (
        <div className={`${styles.gridContainer} ${getGridClass()}`}>
            {charts.map((chart) => (
                <div
                    key={chart.id}
                    className={`${styles.chartWrapper} ${activeChartId === chart.id && layout !== '1' ? styles.active : ''}`}
                    onClick={() => onActiveChartChange(chart.id)}
                >
                    <ChartErrorBoundary>
                        <ChartComponent
                            ref={(el) => {
                                if (chartRefs.current) {
                                    chartRefs.current[chart.id] = el;
                                }
                            }}
                            feed={feedMap.get(chart.id)}
                            symbol={chart.symbol}
                            interval={chart.interval}
                            onAlertsSync={onAlertsSync ? (alerts) => onAlertsSync(chart.id, chart.symbol, alerts) : undefined}
                            onAlertTriggered={onAlertTriggered ? (evt) => onAlertTriggered(chart.id, chart.symbol, evt) : undefined}
                            onReplayModeChange={onReplayModeChange ? (isActive) => onReplayModeChange(chart.id, isActive) : undefined}
                            {...chartProps}
                            indicators={chart.indicators}
                            comparisonSymbols={chart.comparisonSymbols}
                        />
                    </ChartErrorBoundary>
                </div>
            ))}
        </div>
    );
};

export default ChartGrid;
