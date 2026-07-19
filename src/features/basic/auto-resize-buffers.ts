import { matchBufferSize } from '@src/infrastructure/prun-ui/buffer-sizes';
import { setBufferSize } from '@src/infrastructure/prun-ui/buffers';

const pastWindows: WeakSet<Element> = new WeakSet();

async function onTileReady(tile: PrunTile) {
  if (tile.docked) {
    return;
  }

  if (!pastWindows.has(tile.container)) {
    // 跳过首次磁贴激活，因为主 tiles.ts 会自行调整大小
    pastWindows.add(tile.container);
    return;
  }

  const size = matchBufferSize(tile.fullCommand) ?? [450, 300];
  const buffer = tile.frame.closest(`.${C.Window.window}`);
  if (!buffer) {
    return;
  }

  const body = await $(buffer, C.Window.body);
  const width = parseInt(body.style.width.replace('px', ''), 10);
  const height = parseInt(body.style.height.replace('px', ''), 10);
  setBufferSize(tile.id, Math.max(size[0], width), Math.max(size[1], height));
}

function init() {
  tiles.observeAll(onTileReady);
}

features.add(import.meta.url, init, '切换命令时自动调整缓冲区大小。');
