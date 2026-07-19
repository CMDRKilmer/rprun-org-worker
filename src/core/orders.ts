import { productionStore } from '@src/infrastructure/prun-api/data/production';
import { userDataStore } from '@src/infrastructure/prun-api/data/user-data';

// MM 订单没有数量字段。
export function isFiniteOrder(
  order: PrunApi.CXBrokerOrder,
): order is PrunApi.CXBrokerOrder & { amount: number } {
  return order.amount !== null;
}

// 如果任一生产线有循环订单，则视所有生产线都有循环订单。
const hasRecurringOrders = computed(() => {
  if (userDataStore.subscriptionLevel !== 'PRO') {
    return false;
  }
  return productionStore.all.value?.some(line => line.orders.some(x => x.recurring)) ?? false;
});

export function getRecurringOrders(line: PrunApi.ProductionLine) {
  return hasRecurringOrders.value
    ? line.orders.filter(x => !x.started && x.recurring)
    : line.orders.filter(x => !x.started);
}
