import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary.jsx'
import { executionEngine } from './engine/trading/ExecutionEngine'
import { tradeJournalService } from './services/journal/TradeJournalService'
/*
const originalMeasure = performance.measure;
performance.measure = function(name, ...args) {
  console.warn(`Caught performance.measure call for: "${name}"`);
  console.trace(); // This prints the exact file and line number that called it
  return originalMeasure.call(performance, name, ...args);
};
*/
executionEngine.start();      // subscribes to EventBus CANDLE events
tradeJournalService.start();  // auto-creates journal entries from fill events

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
