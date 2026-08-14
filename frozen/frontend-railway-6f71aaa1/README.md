# 冻结前端制品

此目录保存用户指定的 Railway 前端静态制品，不是可编辑源码。

- Railway project: `fba9046c-e92e-462c-a695-0751efc46a10`
- Environment: `test` (`3553098c-3f6f-4e8a-9c1f-92ac9544cd2d`)
- Service: `frontend` (`ef9b2601-1477-4e9a-8ce8-8cb9518e7be8`)
- Deployment: `6f71aaa1-d3b7-4dc9-8395-0ac5f513eeb0`
- Source URL: `https://frontend-test-a8da.up.railway.app/`

`manifest.json` 记录 Railway 镜像摘要和每个文件的 SHA-256。生产 Web 镜像直接复制 `dist/`，不重新编译 `apps/web/src`，以防止本地 React 前端替换已冻结的 Vue/Element Plus 页面。

Railway 可见部署记录中没有 2026-05-15 之前仍可下载的成功制品。因此，本目录只能证明它来自上述当前可访问部署，并且路由、Vue/Element Plus 技术栈与用户截图一致；不能把它表述为已验证的“5 月源码”。在获得更早镜像或源码前，不得修改这些冻结文件来推测性还原页面。

校验命令：

```bash
pnpm frontend:frozen:verify
```
