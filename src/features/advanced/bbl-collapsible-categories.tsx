import css from '@src/utils/css-utils.module.css';
import $style from './bbl-collapsible-categories.module.css';

function onTileReady(tile: PrunTile) {
  subscribe($$(tile.anchor, C.SectionList.container), container => {
    for (const divider of _$$(container, C.SectionList.divider)) {
      // 默认隐藏基础设施（即第一个分类）
      const enabled = ref(container.firstChild !== divider);
      divider.addEventListener('click', e => {
        enabled.value = !enabled.value;
        e.stopPropagation();
        e.preventDefault();
      });
      const indicatorClass = computed(() => ({
        [C.RadioItem.indicator]: true,
        [C.RadioItem.active]: enabled.value,
        [C.effects.shadowPrimary]: enabled.value,
      }));
      createFragmentApp(() => <div class={indicatorClass.value} />).prependTo(divider);
    }
  });
}

function init() {
  applyCssRule(
    'BBL',
    `.${C.SectionList.divider}:not(:has(.${C.RadioItem.active})) + div`,
    css.hidden,
  );
  applyCssRule('BBL', `.${C.SectionList.divider}`, $style.divider);
  tiles.observe('BBL', onTileReady);
}

features.add(import.meta.url, init, 'BBL：使类别可折叠，并默认折叠"基础设施"类别。');
