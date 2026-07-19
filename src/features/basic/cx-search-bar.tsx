import { getMaterialName } from '@src/infrastructure/prun-ui/i18n';
import $style from './cx-search-bar.module.css';
import { materialsStore } from '@src/infrastructure/prun-api/data/materials';
import css from '@src/utils/css-utils.module.css';
import { watchEffectWhileNodeAlive } from '@src/utils/watch';
import TextInput from '@src/components/forms/TextInput.vue';
import PrunButton from '@src/components/PrunButton.vue';
import fa from '@src/utils/font-awesome.module.css';
import { refValue } from '@src/utils/reactive-dom';

function onTileReady(tile: PrunTile) {
  subscribe($$(tile.anchor, C.ComExPanel.input), onComExPanelReady);
}

async function onComExPanelReady(comExPanel: HTMLElement) {
  const actionBar = await $(comExPanel, C.ActionBar.container);
  const select = await $(actionBar, 'select');
  const selectValue = refValue(select);
  const searchText = ref('');

  const categoryOptions = new Map<string, HTMLElement>();
  for (const option of Array.from(select.options)) {
    categoryOptions.set(option.value, option);
  }

  const materialRows = new Map<string, HTMLElement>();

  async function loadMaterialRows() {
    const tbody = await $(comExPanel, 'tbody');
    for (const row of _$$(tbody, 'tr')) {
      const labelText = await $(row, C.ColoredIcon.label);
      materialRows.set(labelText.innerText, row);
    }
    triggerRef(searchText);
  }

  // 如果 CX 加载了一个尚未从服务器获取的分类，会生成一个新的 tbody
  subscribe($$(comExPanel, 'tbody'), loadMaterialRows);

  // 如果 CX 加载的是已缓存的分类，则从内存加载数据，仅 tr 会变化
  watch(selectValue, loadMaterialRows);

  const resetMatches = (value: HTMLElement) => {
    if (value.isConnected) {
      value.classList.toggle(css.hidden, searchText.value.length !== 0);
    }
  };

  // 主搜索循环
  watchEffectWhileNodeAlive(comExPanel, () => {
    const searchTerm = searchText.value.toUpperCase();

    categoryOptions.forEach(resetMatches);
    materialRows.forEach(resetMatches);

    const materials = materialsStore.all.value;
    if (searchTerm.length === 0 || !materials) {
      return;
    }
    for (const material of materials) {
      if (
        material.ticker.includes(searchTerm) ||
        getMaterialName(material)?.toUpperCase().includes(searchTerm)
      ) {
        const optionElement = categoryOptions.get(material.category);
        if (optionElement) {
          optionElement.classList.remove(css.hidden);
        }
        const rowElement = materialRows.get(material.ticker);
        if (rowElement?.isConnected) {
          rowElement.classList.remove(css.hidden);
        }
      }
    }
  });

  createFragmentApp(() => (
    <div class={[C.ActionBar.element, $style.container]}>
      Search:&nbsp;
      <TextInput v-model={searchText.value} />
      <PrunButton dark class={[$style.button, fa.solid]} onClick={() => (searchText.value = '')}>
        {'\uf00d'}
      </PrunButton>
    </div>
  )).prependTo(actionBar);
}

function init() {
  tiles.observe('CX', onTileReady);
}

features.add(import.meta.url, init, 'CX：添加材料搜索栏。');
