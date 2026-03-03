const fs = require('fs');

const content = fs.readFileSync('content.js', 'utf8');

const markers = {
    config: content.search(/(\/\/ ─── КОНФІГ)/),
    utils: content.search(/(\/\/ ─── УТИЛІТИ)/),
    analyzer: content.search(/(\/\/ ─── АНАЛІЗАТОР ВЕЙВФОРМИ)/),
    render: content.search(/(\/\/ ─── РЕНДЕР)/),
    injector: content.search(/(\/\/ ─── ІНЖЕКЦІЯ)/),
    uiTemplates: content.search(/(\/\/ ─── ШАБЛОНИ UI)/),
    uiPanel: content.search(/(\/\/ ─── UI ПАНЕЛЬ)/),
    init: content.search(/(\/\/ ─── ІНІЦІАЛІЗАЦІЯ)/),
    end: content.length
};

if (!fs.existsSync('src')) fs.mkdirSync('src');

const getSec = (startStr, endStr) => {
    return content.substring(markers[startStr], markers[endStr] || markers.end);
};

let configCode = getSec('config', 'utils');
// replace `const CONFIG` with `window.CONFIG` and `let state` with `window.state` for cross-file safety
configCode = configCode.replace('const CONFIG', 'window.CONFIG');
configCode = configCode.replace(/let state =/, 'window.state =');
configCode = configCode.replace(/let isPanelClosedByUser =/, 'window.isPanelClosedByUser =');
configCode = configCode.replace(/let activeObservers =/, 'window.activeObservers =');
configCode = configCode.replace(/let activeEventListeners =/, 'window.activeEventListeners =');
configCode = configCode.replace(/let domCache =/, 'window.domCache =');

let utilsCode = getSec('utils', 'analyzer');
let analyzerCode = getSec('analyzer', 'render');
let logRegex = /log\(/g;
let updateStatusRegex = /updateStatus\(/g;

let renderCode = getSec('render', 'injector');
let injectorCode = getSec('injector', 'uiTemplates');
let uiCode = getSec('uiTemplates', 'init') + getSec('uiPanel', 'init'); // templates and panel
let initCode = getSec('init', 'end');

// Prepend window. to variables
const windowify = (code) => {
    let c = code.replace(/\bCONFIG\b/g, 'window.CONFIG');
    c = c.replace(/\bstate\b/g, 'window.state');
    c = c.replace(/\bisPanelClosedByUser\b/g, 'window.isPanelClosedByUser');
    c = c.replace(/\bactiveObservers\b/g, 'window.activeObservers');
    c = c.replace(/\bactiveEventListeners\b/g, 'window.activeEventListeners');
    c = c.replace(/\bdomCache\b/g, 'window.domCache');
    return c;
};

fs.writeFileSync('src/config.js', windowify(configCode));
fs.writeFileSync('src/utils.js', windowify(utilsCode));
fs.writeFileSync('src/analyzer.js', windowify(analyzerCode));
fs.writeFileSync('src/render.js', windowify(renderCode));
fs.writeFileSync('src/injector.js', windowify(injectorCode));
fs.writeFileSync('src/ui.js', windowify(uiCode));
fs.writeFileSync('src/init.js', windowify(initCode));

console.log("Files generated in src/");
