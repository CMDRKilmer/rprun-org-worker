import { refPrunId } from '@src/infrastructure/prun-ui/attributes';
import QuickRefuelButton from '@src/features/basic/shpf-quick-refuel/QuickRefuelButton.vue';

function onTileReady(tile: PrunTile) {
  subscribe($$(tile.anchor, 'tr'), row => onRowReady(row as HTMLTableRowElement, tile));
}

function onRowReady(row: HTMLTableRowElement, tile: PrunTile) {
  const id = refPrunId(row);
  if (!id.value) {
    return;
  }

  const commandsCell = row.lastElementChild;
  if (!(commandsCell instanceof HTMLElement) || commandsCell.dataset.rprunQuickRefuel === '1') {
    return;
  }

  const buttonProps = reactive({
    dark: true,
    direct: true,
    id,
    inline: true,
    label: '加油',
    tile,
  });
  const lastButton = commandsCell.querySelector('button:last-of-type');
  if (lastButton instanceof HTMLElement) {
    createFragmentApp(QuickRefuelButton, buttonProps).after(lastButton);
  } else {
    createFragmentApp(QuickRefuelButton, buttonProps).appendTo(commandsCell);
  }

  commandsCell.dataset.rprunQuickRefuel = '1';
}

function init() {
  tiles.observe(['FLT', 'FLTS', 'FLTP'], onTileReady);
}

features.add(import.meta.url, init, 'FLT：在卸货按钮右侧添加加油按钮。');
