import $style from './flt-flex-fuel.module.css';

function init() {
  applyCssRule(['FLT', 'FLTS', 'FLTP'], `.${C.ShipFuel.container}`, $style.fuelFlex);
}

features.add(import.meta.url, init, 'FLT：使燃料列布局更好地利用可用空间。');
