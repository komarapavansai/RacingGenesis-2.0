import './test_browser_env.mjs';
import assert from 'node:assert/strict';
await import('./app.js');
assert.ok(window.racingApp, 'Application initialization failed');
console.log('Application initialized successfully.');
