import $style from './cxpc-chart-types.module.css';
import { watchEffectWhileNodeAlive } from '@src/utils/watch';
import { cxobStore } from '@src/infrastructure/prun-api/data/cxob';
import { cxpcStore } from '@src/infrastructure/prun-api/data/cxpc';
import { COMEX_BROKER_PRICES } from '@src/infrastructure/prun-api/client-messages';
import { dispatchClientPrunMessage } from '@src/infrastructure/prun-api/prun-api-listener';
import { userData } from '@src/store/user-data';
import SettingsGroup from '@src/features/basic/cxpc-chart-types/SettingsGroup.vue';
import { computedTileState } from '@src/store/user-data-tiles';
import { getTileState } from '@src/features/basic/cxpc-chart-types/tile-state';

function onTileReady(tile: PrunTile) {
  const ticker = tile.parameter!;
  const broker = computed(() => cxobStore.getByTicker(ticker));
  const cxpc = computed(() => cxpcStore.getById(broker.value?.id));
  const chartType = computedTileState(getTileState(tile), 'chartType', undefined);
  if (chartType.value === undefined) {
    chartType.value = userData.settings.defaultChartType;
  }

  subscribe($$(tile.anchor, C.ChartContainer.container), container => {
    watchEffectWhileNodeAlive(container, () => {
      if (!cxpc.value) {
        return;
      }

      switch (chartType.value) {
        case 'SMOOTH': {
          smooth(cxpc.value);
          break;
        }
        case 'ALIGNED': {
          aligned(cxpc.value);
          break;
        }
        case 'RAW': {
          raw(cxpc.value);
          break;
        }
      }
    });
  });

  subscribe($$(tile.anchor, C.ChartContainer.settings), settings => {
    createFragmentApp(
      SettingsGroup,
      reactive({
        chartType,
        onChange: (type: UserData.ExchangeChartType) => {
          chartType.value = type;
        },
      }),
    ).appendTo(settings);
  });
}

function smooth(data: PrunApi.CXBrokerPrices) {
  const payload = { ...data, prices: [] as PrunApi.CXIntervalPrices[] };
  for (const interval of data.prices) {
    const intervalCopy = { ...interval };
    payload.prices.push(intervalCopy);
    if (interval.prices.length < 2) {
      continue;
    }

    // 执行 Heikin-Ashi 变换
    const ha = [] as typeof interval.prices;
    interval.prices.forEach((c, i) => {
      // 1. HA-收盘价：原始 OHLC 的均值
      const haClose = (c.open + c.high + c.low + c.close) / 4;

      // 2. HA-开盘价：前一周期 HA 开盘/收盘均值（首根K线用种子值）
      const haOpen = i === 0 ? (c.open + c.close) / 2 : (ha[i - 1].open + ha[i - 1].close) / 2;

      // 3. HA-最高/最低价：最高价、开盘价、收盘价中的极值
      const haHigh = Math.max(c.high, haOpen, haClose);
      const haLow = Math.min(c.low, haOpen, haClose);

      ha.push({ ...c, open: haOpen, high: haHigh, low: haLow, close: haClose });
    });
    intervalCopy.prices = ha;
  }
  const messsage = COMEX_BROKER_PRICES(payload);
  dispatchClientPrunMessage(messsage);
}

function aligned(data: PrunApi.CXBrokerPrices) {
  const payload = { ...data, prices: [] as PrunApi.CXIntervalPrices[] };
  data = structuredClone(data);
  for (const interval of data.prices) {
    const intervalCopy = { ...interval };
    payload.prices.push(intervalCopy);
    if (interval.prices.length < 2) {
      continue;
    }

    // 执行成交量加权的开盘/收盘价变换
    const vwap = [] as typeof interval.prices;
    vwap.push({ ...interval.prices[0] });
    let previous = vwap[0];
    for (let i = 1; i < interval.prices.length; i++) {
      const current = { ...interval.prices[i] };
      vwap.push(current);
      const average =
        (current.open * current.volume + previous.close * previous.volume) /
        (current.volume + previous.volume);
      previous.close = average;
      current.open = average;
      previous = current;
    }
    intervalCopy.prices = vwap;
  }
  const messsage = COMEX_BROKER_PRICES(payload);
  dispatchClientPrunMessage(messsage);
}

function raw(data: PrunApi.CXBrokerPrices) {
  const messsage = COMEX_BROKER_PRICES(data);
  dispatchClientPrunMessage(messsage);
}

function init() {
  tiles.observe('CXPC', onTileReady);
  applyCssRule('CXPC', `.${C.ChartContainer.settings}`, $style.settings);
}

features.add(import.meta.url, init, 'CXPC：添加"平滑"和"对齐"图表类型。');
