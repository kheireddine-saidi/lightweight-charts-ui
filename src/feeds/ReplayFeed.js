export class ReplayFeed {
  constructor(data = []) { this._data = data; }
  setData(data) { this._data = data; }
  async loadHistory() { return this._data; }
  subscribe(_symbol, _interval, _onCandle) { return () => {}; }
}
