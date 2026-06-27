import { useState, useEffect, useRef } from 'react';
import { subscribeToMultiTicker } from '../../services/binance';

const ALERT_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

const safeParseJSON = (value: string | null, fallback: any) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const formatPrice = (value: any) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return num.toFixed(2);
};

export function useAlerts(
  currentSymbol: string,
  onShowToast: (msg: string, type: string) => void
) {
  const [alerts, setAlerts] = useState<any[]>(() => {
    const saved = safeParseJSON(localStorage.getItem('tv_alerts'), []);
    if (!Array.isArray(saved)) return [];
    const cutoff = Date.now() - ALERT_RETENTION_MS;
    return saved.filter((a: any) => {
      const ts = a && a.created_at ? new Date(a.created_at).getTime() : NaN;
      return Number.isFinite(ts) && ts >= cutoff;
    });
  });

  const alertsRef = useRef(alerts);
  useEffect(() => { alertsRef.current = alerts; }, [alerts]);

  const [alertLogs, setAlertLogs] = useState<any[]>(() => {
    const saved = safeParseJSON(localStorage.getItem('tv_alert_logs'), []);
    if (!Array.isArray(saved)) return [];
    const cutoff = Date.now() - ALERT_RETENTION_MS;
    return saved.filter((l: any) => {
      const ts = l && l.time ? new Date(l.time).getTime() : NaN;
      return Number.isFinite(ts) && ts >= cutoff;
    });
  });

  const [unreadAlertCount, setUnreadAlertCount] = useState(0);

  const skipNextSyncRef = useRef<any>(null);
  const alertSymbolsRef = useRef<string[]>([]);
  const [alertWsSymbols, setAlertWsSymbols] = useState<string[]>([]);

  // Persist alerts with 24h retention
  useEffect(() => {
    const cutoff = Date.now() - ALERT_RETENTION_MS;
    const filtered = alerts.filter((a: any) => {
      const ts = a && a.created_at ? new Date(a.created_at).getTime() : NaN;
      return Number.isFinite(ts) && ts >= cutoff;
    });
    if (filtered.length !== alerts.length) {
      setAlerts(filtered);
      return;
    }
    try {
      localStorage.setItem('tv_alerts', JSON.stringify(filtered));
    } catch (error) {
      console.error('Failed to persist alerts:', error);
    }
  }, [alerts]);

  // Persist alert logs with 24h retention
  useEffect(() => {
    const cutoff = Date.now() - ALERT_RETENTION_MS;
    const filtered = alertLogs.filter((l: any) => {
      const ts = l && l.time ? new Date(l.time).getTime() : NaN;
      return Number.isFinite(ts) && ts >= cutoff;
    });
    if (filtered.length !== alertLogs.length) {
      setAlertLogs(filtered);
      return;
    }
    try {
      localStorage.setItem('tv_alert_logs', JSON.stringify(filtered));
    } catch (error) {
      console.error('Failed to persist alert logs:', error);
    }
  }, [alertLogs]);

  // Update symbol list when alerts change
  useEffect(() => {
    const activeNonLineToolAlerts = alerts.filter(
      (a: any) => a.status === 'Active' && a._source !== 'lineTools'
    );
    const newSymbols = [...new Set(activeNonLineToolAlerts.map((a: any) => a.symbol))].sort();
    const currentSymbols = alertSymbolsRef.current;
    if (JSON.stringify(newSymbols) !== JSON.stringify(currentSymbols)) {
      alertSymbolsRef.current = newSymbols as string[];
    }
  }, [alerts]);

  // Separate effect: only reconnect WebSocket when symbols actually change
  useEffect(() => {
    const interval = setInterval(() => {
      const currentSymbols = alertSymbolsRef.current;
      if (JSON.stringify(currentSymbols) !== JSON.stringify(alertWsSymbols)) {
        setAlertWsSymbols([...currentSymbols]);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [alertWsSymbols]);

  // Alert WebSocket
  useEffect(() => {
    if (alertWsSymbols.length === 0) return;
    const ws = subscribeToMultiTicker(alertWsSymbols, (ticker: any) => {
      setAlerts((prevAlerts) => {
        let hasChanges = false;
        const newAlerts = prevAlerts.map((alert) => {
          if (alert._source === 'lineTools') return alert;
          if (alert.status !== 'Active' || alert.symbol !== ticker.symbol) return alert;
          const currentPrice = parseFloat(ticker.last);
          const targetPrice = parseFloat(alert.price);
          if (!Number.isFinite(currentPrice) || !Number.isFinite(targetPrice) || targetPrice === 0) return alert;
          const threshold = targetPrice * 0.001;
          if (Math.abs(currentPrice - targetPrice) <= threshold) {
            hasChanges = true;
            const displayPrice = formatPrice(targetPrice);
            const logEntry = {
              id: Date.now(),
              alertId: alert.id,
              symbol: alert.symbol,
              message: `Alert triggered: ${alert.symbol} crossed ${displayPrice}`,
              time: new Date().toISOString(),
            };
            setAlertLogs((prev) => [logEntry, ...prev]);
            setUnreadAlertCount((prev) => prev + 1);
            onShowToast(`Alert Triggered: ${alert.symbol} at ${displayPrice}`, 'info');
            return { ...alert, status: 'Triggered' };
          }
          return alert;
        });
        return hasChanges ? newAlerts : prevAlerts;
      });
    });
    return () => { if (ws) ws.close(); };
  }, [alertWsSymbols]);

  const handleSaveAlert = (alertData: any, chartRefs: any, activeChartId: number) => {
    const priceDisplay = formatPrice(alertData.value);
    const newAlert = {
      id: Date.now(),
      symbol: currentSymbol,
      price: priceDisplay,
      condition: `Crossing ${priceDisplay}`,
      status: 'Active',
      created_at: new Date().toISOString(),
    };
    setAlerts((prev) => [...prev, newAlert]);
    onShowToast(`Alert created for ${currentSymbol} at ${priceDisplay}`, 'success');
    const activeRef = chartRefs.current[activeChartId];
    if (activeRef && typeof activeRef.addPriceAlert === 'function') {
      activeRef.addPriceAlert(newAlert);
    }
  };

  const handleRemoveAlert = (id: any, chartRefs: any) => {
    setAlerts((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target && target._source === 'lineTools' && target.chartId != null && target.externalId) {
        const chartRef = chartRefs.current[target.chartId];
        if (chartRef && typeof chartRef.removePriceAlert === 'function') {
          chartRef.removePriceAlert(target.externalId);
        }
      }
      return prev.filter((a) => a.id !== id);
    });
  };

  const handleRestartAlert = (id: any, alerts: any[], chartRefs: any) => {
    const target = alerts.find((a) => a.id === id);
    if (!target) return;
    let originalCondition = 'crossing';
    if (target.condition) {
      const condLower = target.condition.toLowerCase();
      if (condLower.includes('crossing_down') || condLower.includes('crossing down')) {
        originalCondition = 'crossing_down';
      } else if (condLower.includes('crossing_up') || condLower.includes('crossing up')) {
        originalCondition = 'crossing_up';
      }
    }
    skipNextSyncRef.current = { type: 'resume', alertId: id, chartId: target.chartId };
    if (target._source === 'lineTools' && target.chartId != null) {
      const chartRef = chartRefs.current[target.chartId];
      if (chartRef && typeof chartRef.restartPriceAlert === 'function') {
        chartRef.restartPriceAlert(target.price, originalCondition);
      }
    }
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'Active' } : a)));
  };

  const handlePauseAlert = (id: any, alerts: any[], chartRefs: any) => {
    const target = alerts.find((a) => a.id === id);
    if (!target) return;
    skipNextSyncRef.current = { type: 'pause' };
    if (target._source === 'lineTools' && target.chartId != null && target.externalId) {
      const chartRef = chartRefs.current[target.chartId];
      if (chartRef && typeof chartRef.removePriceAlert === 'function') {
        chartRef.removePriceAlert(target.externalId);
      }
    }
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'Paused' } : a)));
  };

  const handleChartAlertsSync = (
    chartId: number,
    symbol: string,
    chartAlerts: any[],
    alerts: any[]
  ) => {
    const syncInfo = skipNextSyncRef.current;
    if (syncInfo && syncInfo.type === 'pause') {
      skipNextSyncRef.current = null;
      return;
    }
    if (syncInfo && syncInfo.type === 'resume' && syncInfo.chartId === chartId) {
      skipNextSyncRef.current = null;
      const existingForChart = alerts.filter(
        (a) => a._source === 'lineTools' && a.chartId === chartId && a.status === 'Active'
      );
      const existingExternalIds = new Set(existingForChart.map((a) => a.externalId));
      const newChartAlert = (chartAlerts || []).find((a) => !existingExternalIds.has(a.id));
      if (newChartAlert) {
        setAlerts((prev) =>
          prev.map((a) =>
            a.id === syncInfo.alertId
              ? { ...a, externalId: newChartAlert.id, status: 'Active' }
              : a
          )
        );
      }
      return;
    }

    setAlerts((prev) => {
      const chartAlertIds = new Set((chartAlerts || []).map((a) => a.id));
      const existingForChart = prev.filter(
        (a) => a._source === 'lineTools' && a.chartId === chartId
      );
      const existingExternalIds = new Set(existingForChart.map((a) => a.externalId));
      const remaining = prev.filter((a) => {
        if (a._source !== 'lineTools' || a.chartId !== chartId) return true;
        if (a.status === 'Triggered' || a.status === 'Paused') return true;
        return chartAlertIds.has(a.externalId);
      });
      const newChartAlerts = (chartAlerts || []).filter((a) => !existingExternalIds.has(a.id));
      const newMapped = newChartAlerts.map((a) => {
        const priceDisplay = formatPrice(a.price);
        let conditionDisplay = `Crossing ${priceDisplay}`;
        if (a.condition === 'crossing_up') conditionDisplay = `Crossing Up ${priceDisplay}`;
        else if (a.condition === 'crossing_down') conditionDisplay = `Crossing Down ${priceDisplay}`;
        else if (a.condition && a.condition !== 'crossing') conditionDisplay = a.condition;
        onShowToast(`Alert created for ${symbol} at ${priceDisplay}`, 'success');
        return {
          id: `lt-${chartId}-${a.id}`,
          externalId: a.id,
          symbol,
          price: priceDisplay,
          condition: conditionDisplay,
          status: 'Active',
          created_at: new Date().toISOString(),
          _source: 'lineTools',
          chartId,
        };
      });
      return [...remaining, ...newMapped];
    });
  };

  const handleChartAlertTriggered = (chartId: number, symbol: string, evt: any) => {
    const displayPrice = formatPrice(evt.price ?? evt.alertPrice);
    const timestamp = evt.timestamp
      ? new Date(evt.timestamp).toISOString()
      : new Date().toISOString();
    const logEntry = {
      id: Date.now(),
      alertId: evt.externalId || evt.alertId,
      symbol,
      message: `Alert triggered: ${symbol} crossed ${displayPrice}`,
      time: timestamp,
    };
    setAlertLogs((prev) => [logEntry, ...prev]);
    setUnreadAlertCount((prev) => prev + 1);
    onShowToast(`Alert Triggered: ${symbol} at ${displayPrice}`, 'info');
    setAlerts((prev) => {
      let updated = false;
      const next = prev.map((a) => {
        if (
          a._source === 'lineTools' &&
          a.chartId === chartId &&
          a.externalId === (evt.externalId || evt.alertId)
        ) {
          updated = true;
          return { ...a, status: 'Triggered' };
        }
        return a;
      });
      if (!updated) {
        next.unshift({
          id: `lt-${chartId}-${evt.externalId || evt.alertId}-triggered-${Date.now()}`,
          externalId: evt.externalId || evt.alertId,
          symbol,
          price: displayPrice,
          condition: evt.condition || `Crossing ${displayPrice}`,
          status: 'Triggered',
          created_at: timestamp,
          _source: 'lineTools',
          chartId,
        });
      }
      return next;
    });
  };

  return {
    alerts,
    alertLogs,
    unreadAlertCount,
    skipNextSyncRef,
    handleSaveAlert,
    handleRemoveAlert,
    handleRestartAlert,
    handlePauseAlert,
    handleChartAlertsSync,
    handleChartAlertTriggered,
    markAlertsRead: () => setUnreadAlertCount(0),
  };
}
