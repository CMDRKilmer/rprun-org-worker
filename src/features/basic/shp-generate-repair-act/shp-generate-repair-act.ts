import GenerateRepairActButton from './GenerateRepairActButton.vue';

async function onTileReady(tile: PrunTile) {
  if (!tile.parameter) {
    return;
  }

  const repairBtn = await $(tile.anchor, C.Button.btn);
  createFragmentApp(GenerateRepairActButton, { registration: tile.parameter }).after(repairBtn);
}

function init() {
  tiles.observe('SHP', onTileReady);
}

features.add(import.meta.url, init, 'SHP：在维修按钮旁添加生成维修 ACT 包的按钮。');
