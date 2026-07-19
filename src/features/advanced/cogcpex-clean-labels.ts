function onTileReady(tile: PrunTile) {
  // 将 '查看详情/投票' 替换为 '投票'
  subscribe($$(tile.anchor, C.Button.darkInline), button => {
    button.textContent = '投票';
  });

  // 移除冗余的标题部分
  subscribe($$(tile.anchor, C.Link.link), link => {
    if (link.textContent) {
      link.textContent = link
        .textContent!.replace('Advertising Campaign: ', '')
        .replace('Education Events: ', '');
    }
  });
}

function init() {
  tiles.observe('COGCPEX', onTileReady);
}

features.add(import.meta.url, init, 'COGCPEX：隐藏活动标签中的"广告活动："和"教育活动："部分。');
