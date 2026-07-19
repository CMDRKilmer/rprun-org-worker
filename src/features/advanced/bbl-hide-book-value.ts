import css from '@src/utils/css-utils.module.css';

function init() {
  applyCssRule(
    'BBL',
    `.${C.SectionList.section} .${C.SectionList.table} tr:nth-child(5)`,
    css.hidden,
  );
}

features.add(import.meta.url, init, 'BBL：隐藏"账面价值"行。');
