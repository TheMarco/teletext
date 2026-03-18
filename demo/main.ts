import { processPage } from '../src/state-machine/state-machine.js';
import { renderToBuffer, BUFFER_WIDTH, BUFFER_HEIGHT } from '../src/render-buffer/render-buffer.js';
import { createTimingState, advanceTiming } from '../src/timing-engine/timing-engine.js';
import { buildDemoPage } from './demo-page.js';

// PAL teletext: 480×240 raw pixels displayed at 4:3 aspect ratio.
// To achieve 4:3 from 480×240 (2:1 raw), we scale Y by 2× relative to X.
// At SCALE=2: display = 960×960 → but that's 1:1.
// Correct: display height = display width * 3/4.
// display width = BUFFER_WIDTH * SCALE_X, display height = BUFFER_HEIGHT * SCALE_Y
// We want (BUFFER_WIDTH * SX) / (BUFFER_HEIGHT * SY) = 4/3
// 480*SX / 240*SY = 4/3 → 2*SX/SY = 4/3 → SY = 1.5*SX
const SCALE_X = 2;
const SCALE_Y = SCALE_X * 1.5; // Corrects 2:1 raw to 4:3 display
const canvasWidth = BUFFER_WIDTH * SCALE_X;   // 960
const canvasHeight = BUFFER_HEIGHT * SCALE_Y;  // 720

const canvas = document.createElement('canvas');
canvas.width = canvasWidth;
canvas.height = canvasHeight;
canvas.style.imageRendering = 'pixelated';
canvas.style.background = '#000';

// Center it
document.body.style.margin = '0';
document.body.style.background = '#111';
document.body.style.display = 'flex';
document.body.style.justifyContent = 'center';
document.body.style.alignItems = 'center';
document.body.style.minHeight = '100vh';
document.body.appendChild(canvas);

const ctx = canvas.getContext('2d')!;

// Controls
const controls = document.createElement('div');
controls.style.position = 'fixed';
controls.style.bottom = '16px';
controls.style.left = '50%';
controls.style.transform = 'translateX(-50%)';
controls.style.display = 'flex';
controls.style.gap = '12px';
controls.style.fontFamily = 'monospace';
controls.style.fontSize = '14px';
controls.style.color = '#ccc';

const revealBtn = document.createElement('button');
revealBtn.textContent = 'Reveal';
revealBtn.style.fontFamily = 'monospace';
revealBtn.style.padding = '6px 16px';
revealBtn.style.cursor = 'pointer';
controls.appendChild(revealBtn);

const flashLabel = document.createElement('span');
flashLabel.style.padding = '6px 0';
controls.appendChild(flashLabel);

document.body.appendChild(controls);

// State
const pageData = buildDemoPage();
const grid = processPage(pageData);
let timing = createTimingState();
let reveal = false;

revealBtn.addEventListener('click', () => {
  reveal = !reveal;
  revealBtn.textContent = reveal ? 'Hide' : 'Reveal';
});

function render() {
  const result = renderToBuffer(grid, timing.flashPhase, reveal);

  // Write to canvas via ImageData (scaled)
  const imageData = ctx.createImageData(BUFFER_WIDTH, BUFFER_HEIGHT);
  imageData.data.set(result.data);

  // Draw at 1:1 then scale
  const offscreen = new OffscreenCanvas(BUFFER_WIDTH, BUFFER_HEIGHT);
  const offCtx = offscreen.getContext('2d')!;
  offCtx.putImageData(imageData, 0, 0);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(offscreen, 0, 0, canvasWidth, canvasHeight);
}

let lastTime = 0;
function frame(time: number) {
  const delta = lastTime ? time - lastTime : 0;
  lastTime = time;

  timing = advanceTiming(timing, delta);
  flashLabel.textContent = `flash: ${timing.flashPhase ? 'ON' : 'OFF'}`;

  render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
