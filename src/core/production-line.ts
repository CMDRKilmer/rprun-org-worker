export function calcCompletionDate(line: PrunApi.ProductionLine, order: PrunApi.ProductionOrder) {
  if (!order.duration) {
    return undefined;
  }

  if (order.completion) {
    return order.completion.timestamp;
  }

  const capacity = line.capacity;
  if (capacity === 0) {
    return undefined;
  }
  const queue: number[] = [];

  for (const lineOrder of line.orders) {
    if (!lineOrder.duration) {
      return undefined;
    }
    if (lineOrder.completion) {
      // 订单已开始
      queue.push(lineOrder.completion.timestamp);
    } else if (queue.length < capacity) {
      // 订单未开始但有容量启动
      queue.push(Date.now() + lineOrder.duration.millis);
    } else {
      // 订单未开始
      queue.sort();
      queue.push(queue.shift()! + lineOrder.duration.millis);
    }
    if (lineOrder === order) {
      return queue.pop();
    }
  }

  return undefined;
}
