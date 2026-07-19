import GenerateBraRepairActButton from './GenerateBraRepairActButton.vue';

async function onTileReady(tile: PrunTile) {
  const repairBtn = await $(tile.anchor, C.Button.btn);
  createFragmentApp(GenerateBraRepairActButton, { planetNaturalId: tile.parameter }).after(
    repairBtn,
  );
}

function init() {
  tiles.observe('BRA', onTileReady);
}

features.add(import.meta.url, init, 'BRA：在维护按钮旁添加生成维修 ACT 包的按钮。');
