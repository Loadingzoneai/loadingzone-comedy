# Loading Zone Comedy / 候场喜剧 — V4 · V2 UI

本版本采用 V2 的 UI/视觉方向，同时保留 V4 的内容结构。

## 演出内容规则
- 用户提供的 10 张照片全部属于 **Past Shows / 过往演出 Gallery**，不作为近期演出默认图片。
- **Upcoming Shows / 近期演出**支持两种来源：
  1. **Eventbrite 自动导入**：标题、日期、时间、场地、图片、票务链接、活动状态等。
  2. **手动添加**：用于其他场地或其他售票平台开票的演出。
- Eventbrite 同步不会覆盖网站手动维护的中文标题、中文简介、置顶、首页展示、排序等字段。
- Past Shows Gallery 独立管理，可从后台继续上传照片、添加演出关联和说明。

## 其他已确认内容
- 正式 Logo 使用用户提供的 `269.png`，不从演出照片裁切。
- 首页 Hero 使用用户最新提供的舞台照片。
- Past Shows 使用横向滑动 Gallery。
- 会员默认一次性购买，可选择自动续费。
- 电子会员卡不使用 QR Code。
- 中文优先，并提供 English 切换。

## 生产环境仍需接入
- Eventbrite OAuth/API 后端
- Stripe Checkout / Billing 与 webhook
- 会员数据库、OTP 登录
- 管理后台鉴权与权限
- Hosting / DNS / HTTPS
Loading Zone Comedy
