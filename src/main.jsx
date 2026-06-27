import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary.jsx'
import { executionEngine } from './engine/trading/ExecutionEngine'
import { tradeJournalService } from './services/journal/TradeJournalService'

executionEngine.start();      // subscribes to EventBus CANDLE events
tradeJournalService.start();  // auto-creates journal entries from fill events

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
