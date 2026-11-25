import fs from 'fs';

// Mock minimal browser globals
const domElements = {};
function getMock(id) {
  if (!domElements[id]) {
    domElements[id] = {
      id: id,
      tagName: 'DIV',
      style: {},
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      open: false,
      showModal() { this.open = true; },
      close() { this.open = false; },
      classList: {
        set: new Set(),
        add(...names) { names.forEach(c => this.set.add(c)); },
        remove(...names) { names.forEach(c => this.set.delete(c)); },
        contains(c) { return this.set.has(c); },
        toggle(c, v) { if (v === undefined ? this.set.has(c) : !v) this.set.delete(c); else this.set.add(c); }
      },
      appendChild() {},
      listeners: {},
      addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); },
      dispatch(type, event = {}) { for (const callback of this.listeners[type] || []) callback({target: this, preventDefault() {}, ...event}); },
      getBoundingClientRect() { return {left: 0, top: 0, width: 320, height: 500}; },
      removeEventListener() {},
      value: '5000',
      dataset: {},
      textContent: '',
      innerHTML: '',
      getContext(type) {
        if (type !== '2d') return null;
        return {
          fillStyle: '',
          strokeStyle: '',
          lineWidth: 1,
          fillRect() {},
          strokeRect() {},
          clearRect() {},
          beginPath() {},
          closePath() {},
          moveTo() {},
          lineTo() {},
          stroke() {},
          fill() {},
          arc() {},
          roundRect() {},
          save() {},
          restore() {},
          translate() {},
          rotate() {},
          setLineDash() {},
          setTransform() {},
          measureText: () => ({ width: 50 }),
          fillText() {},
          createRadialGradient: () => ({ addColorStop() {} }),
          createLinearGradient: () => ({ addColorStop() {} }),
          getImageData: () => ({ data: new Uint8ClampedArray(512 * 512 * 4) }),
          putImageData() {}
        };
      }
    };
  }
  return domElements[id];
}

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const matches = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
matches.forEach(id => getMock(id));
for (const match of html.matchAll(/<input\b([^>]+)>/g)) {
  const id = match[1].match(/id="([^"]+)"/)?.[1];
  if (id) getMock(id).value = match[1].match(/value="([^"]*)"/)?.[1] || '';
}
const buttons = [];
for (const match of html.matchAll(/<button\b([^>]+)>/g)) {
  const attrs = match[1];
  const id = attrs.match(/id="([^"]+)"/)?.[1] || `button${buttons.length}`;
  const button = getMock(id);
  button.tagName = 'BUTTON';
  for (const data of attrs.matchAll(/data-(\w+)="([^"]+)"/g)) button.dataset[data[1]] = data[2];
  button.classes = attrs.match(/class="([^"]+)"/)?.[1].split(' ') || [];
  buttons.push(button);
}
function select(selector) {
  if (selector.includes('data-cam="orbit"')) return buttons.filter(b => b.dataset.cam === 'orbit');
  if (selector === '.cam-btn') return buttons.filter(b => b.classes.includes('cam-btn'));
  if (selector === '#driverModeSwitcher .mode-btn') return buttons.filter(b => b.classes.includes('mode-btn'));
  if (selector === '#panelDriverModeGrid .f1-preset-pill') return buttons.filter(b => b.dataset.mode && b.classes.includes('f1-preset-pill'));
  if (selector === '#f1PresetContainer .f1-preset-pill') return buttons.filter(b => b.dataset.preset);
  if (selector === '.f1-preset-pill') return buttons.filter(b => b.classes.includes('f1-preset-pill'));
  return [];
}

globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

globalThis.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  devicePixelRatio: 1,
  listeners: {},
  addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); },
  dispatch(type, event = {}) { for (const callback of this.listeners[type] || []) callback({preventDefault() {}, ...event}); },
  removeEventListener() {},
  location: { reload() {} },
  performance: { now: () => Date.now() },
  requestAnimationFrame: globalThis.requestAnimationFrame,
  cancelAnimationFrame() {},
  AudioContext: class {
    constructor() {
      this.currentTime = 0;
      this.destination = {};
      this.state = 'running';
    }
    createGain() { return { gain: { value: 1, setValueAtTime(){}, setTargetAtTime(){} }, connect(){ return this; } }; }
    createOscillator() { return { type: '', frequency: { setValueAtTime(){}, setTargetAtTime(){} }, connect(){ return this; }, start(){} }; }
    createBiquadFilter() { return { type: '', frequency: { setValueAtTime(){}, setTargetAtTime(){} }, Q: { setValueAtTime(){} }, connect(){ return this; } }; }
    createWaveShaper() { return { curve: null, connect(){ return this; } }; }
    resume() {}
  }
};

globalThis.document = {
  listeners: {},
  addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); },
  dispatch(type) { for (const callback of this.listeners[type] || []) callback(); },
  getElementById: (id) => domElements[id] || null,
  querySelectorAll: select,
  querySelector: selector => select(selector)[0] || null,
  body: getMock('body'),
  createElement: (tag) => {
    const el = getMock('mock_' + tag + '_' + Math.random().toString(36).substr(2, 5));
    el.tagName = tag.toUpperCase();
    if (tag === 'canvas') {
      el.width = 1024;
      el.height = 512;
    }
    return el;
  },
  createElementNS: (ns, tag) => {
    const el = getMock('mock_ns_' + tag + '_' + Math.random().toString(36).substr(2, 5));
    el.tagName = tag.toUpperCase();
    return el;
  }
};


export {getMock};
