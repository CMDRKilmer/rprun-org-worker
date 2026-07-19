<script setup lang="ts">
import { showBuffer } from '@src/infrastructure/prun-ui/buffers';
</script>

<template>
  <div :class="C.Window.window" style="left: 100px; top: 100px; z-index: 999">
    <div :class="C.Window.header" />
    <div
      :class="C.Window.body"
      style="
        position: relative;
        user-select: auto;
        width: 400px;
        height: 200px;
        box-sizing: border-box;
        flex-shrink: 0;
      ">
      <div :class="C.Tile.tile">
        <div :class="C.TileFrame.frame">
          <div
            :class="[C.TileFrame.header, C.fonts.fontRegular, C.type.typeRegular]"
            style="cursor: default">
            <div :class="[C.TileFrame.title, C.fonts.fontSmallHeaders]">
              REFINED PRUN 迁移指南
            </div>
          </div>
          <div :class="[C.TileFrame.body, C.fonts.fontRegular, C.type.typeRegular]">
            <div :class="C.TileFrame.anchor">
              <div style="width: 100%; height: 100%; padding: 10px">
                <p>PMMG 当前正在运行。请按照迁移指南操作：</p>
                <ol style="padding-inline: 15px; line-height: 1.5">
                  <li>
                    从
                    <span :class="C.Link.link" @click="showBuffer('XIT SET')">XIT SET</span>
                    导出所有用户数据（滚动到最底部）。
                  </li>
                  <li>打开浏览器的扩展程序页面。</li>
                  <li>禁用 PMMG Extended 扩展。</li>
                  <li> 重新加载游戏，选择首选功能集后，使用 XIT SET PMMG 导入 PMMG 文件。 </li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
