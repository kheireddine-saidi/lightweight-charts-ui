import React from 'react';
export class ChartErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error('Chart error:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#131722', color: '#F23645', flexDirection: 'column', gap: 8, padding: 16 }}>
          <span style={{ fontSize: 14 }}>Chart failed to render</span>
          <button style={{ padding: '4px 12px', background: '#2A2E39', color: '#D1D4DC', border: 'none', borderRadius: 4, cursor: 'pointer' }} onClick={() => this.setState({ hasError: false, error: null })}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
