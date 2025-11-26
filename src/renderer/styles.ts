export const GLOBAL_STYLES = String.raw`
:root {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #f5f5f5;
  background-color: #1b1d22;
  --surface-padding: 12px;
  --surface-radius: 12px;
  --section-gap: 12px;
  --log-panel-offset: 360px;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

body,
html {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  background: linear-gradient(180deg, #1f232b 0%, #14161a 100%);
}

body {
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

#root {
  width: 100%;
  max-width: 720px;
  padding: 16px 12px 20px;
  box-sizing: border-box;
}

a {
  color: inherit;
}

button {
  font-family: inherit;
}

.layout {
  display: grid;
  gap: var(--section-gap);
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  grid-auto-flow: row dense;
}

.layout__full {
  grid-column: 1 / -1;
}

.dropzone {
  border: 2px dashed #3a3f4b;
  border-radius: var(--surface-radius);
  padding: var(--surface-padding);
  background-color: #21242b;
  transition: all 0.2s ease;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: none;
  justify-self: stretch;
}

.dropzone.is-dragging {
  border-color: #4ab1ff;
  background-color: rgba(74, 177, 255, 0.1);
}

.dropzone__inner {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card {
  background-color: #1f2733;
  border-radius: var(--surface-radius);
  padding: var(--surface-padding);
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

.card--log {
  min-height: 0;
}

.firmware-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.firmware-item {
  background: #252d3a;
  border-radius: 8px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.alert {
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  text-align: left;
}

.alert--info {
  background: rgba(74, 177, 255, 0.12);
  border: 1px solid rgba(74, 177, 255, 0.4);
  color: #d1e9ff;
}

.alert--error {
  background: rgba(255, 107, 107, 0.12);
  border: 1px solid rgba(255, 107, 107, 0.4);
  color: #ffd1d1;
}

.alert--success {
  background: rgba(87, 215, 133, 0.12);
  border: 1px solid rgba(87, 215, 133, 0.4);
  color: #d9ffe7;
}

.alert--warning {
  background: rgba(240, 173, 78, 0.12);
  border: 1px solid rgba(240, 173, 78, 0.4);
  color: #ffe7c4;
}

.slot-grid {
  display: grid;
  gap: var(--section-gap);
  grid-template-columns: 1fr;
}

@media (min-width: 640px) {
  .slot-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.slot-card {
  background-color: #202733;
  border-radius: 12px;
  padding: 9px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.slot-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.slot-card__progress-bar {
  width: 100%;
  height: 12px;
  border-radius: 999px;
  background-color: #2a3140;
  overflow: hidden;
}

.slot-card__progress {
  height: 100%;
  transition: width 0.2s ease;
}

.subtitle {
  margin: 0;
  font-size: 0.92rem;
  color: #b8c1d1;
  font-weight: 500;
}

.description {
  margin: 4px 0 0 0;
  color: #8a92a3;
  font-size: 13px;
  font-weight: 400;
}

.button {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  background-color: #3a3f4b;
  color: #f5f5f5;
  font-size: 1rem;
  font-weight: 500;
  transition: background 0.15s;
}

.button:hover {
  background-color: #4ab1ff;
  color: #fff;
}

.section-title {
  margin: 0 0 8px 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: #e0e7f5;
  letter-spacing: -0.3px;
}

.info-text {
  color: #c0c7d4;
  font-size: 12px;
  margin: 0;
}

.progress-text {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #a1adbf;
}

.volume-text {
  margin: 0;
  color: #798397;
  font-size: 12px;
}

.log-panel {
  background: #161b23;
  border: 1px solid #222a37;
  border-radius: var(--surface-radius);
  padding: var(--surface-padding);
  height: calc(100vh - var(--log-panel-offset));
  min-height: 160px;
  max-height: none;
  overflow: auto;
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 12px;
}

.log-row {
  display: grid;
  grid-template-columns: 88px 58px 1fr;
  gap: 10px;
  padding: 6px 4px;
  border-bottom: 1px solid #1f2531;
  align-items: center;
}

.log-row:last-child {
  border-bottom: none;
}

.log-time {
  color: #9aa5b8;
}

.log-level {
  font-weight: 700;
  color: #c5ccdb;
}

.log-message {
  color: #e5e9f1;
  word-break: break-word;
}

.log-row--info .log-level {
  color: #7bc3ff;
}

.log-row--warn .log-level {
  color: #f0ad4e;
}

.log-row--error .log-level {
  color: #ff6b6b;
}
`;
