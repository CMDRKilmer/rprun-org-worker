# RUNCN-ORG (后端)

这个目录只包含 **rprun-org-worker**(Cloudflare Worker 后端)。

前端的 ORG 集成在另一个仓库 `RUNCN/`。

## 部署 Worker

参见 [rprun-org-worker/README.md](rprun-org-worker/README.md)。

## 快速链接

- Worker URL: https://prun.kilmer.cn
- Health check: https://prun.kilmer.cn/health
- 前端集成仓库: `../RUNCN/`

## 引导第一个 BOARD 用户

参见 `rprun-org-worker/scripts/bootstrap-board.sql` 和 `rprun-org-worker/README.md` §5。

## 部署踩坑记录

全部踩坑细节记录在 `rprun-org-worker/README.md` 的 "部署踩坑" 章节。