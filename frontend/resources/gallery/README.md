# AI Kitchen Food Gallery

> 2026-11-14 更新：默认配图已改为 31 张抽象封面；本文件下面记录的真实菜品图全部保留并用于装饰轮播。当前接入方式、减少动态效果与加载策略见 [README-abstract.md](README-abstract.md)。

## 本项目接入

原 `public/images/kitchen-table.jpg` 已迁入 `images/kitchen-table.jpg`，用于登录页、首页和最终兜底；它是装饰图，不计入下面的 31 张菜品图库。

`src/resources.ts` 按菜名优先、描述/标签/食材辅助匹配类别，再按菜名关键词选择对应单菜图；番茄炒蛋使用专用图，无具体匹配时在多样化默认池中稳定选择，同一菜名固定选择图片。建议标签仅用于前端图片匹配，不会写入业务标签字典。

菜品列表、菜单封面和详情优先显示 AI 提供的有效 HTTP(S) 图片；缺图、加载失败或尺寸不足时使用图库，详情标注为默认示意图。资源由 Vite 输出到构建目录，无需额外复制 public 文件。

本包包含 31 张独立 WebP 菜品展示图。新增十张使用不同菜品、餐具、背景配色、光线与视角，避免整页重复暖木桌与米色碗盘；旧版相似餐桌图保留归档，不再参与默认选择。

## 目录

- `images/meat-braises/`：家常荤菜、红烧炖菜（8 张）
- `images/vegetables-eggs-tofu/`：蔬菜、蛋类、豆制品（8 张）
- `images/noodles-staples/`：面食、饺子、主食（7 张）
- `images/soups-stews/`：汤羹、炖菜（7 张）
- `images/eggs/`：番茄炒蛋单菜近景（1 张）
- `manifest.json`：图片路径、分类、描述与建议标签
- `preview-expanded.jpg`：旧版 21 张菜品图总览；`preview.jpg` 保留原始总览。
- `generation-prompts.json`：2026-11-12 新增图片的完整提示词和风格参考，使用内置 image_gen 生成。

2026-11-12 新增香菇烧鸡、家常豆腐、葱油拌面、冬瓜肉丸汤各一张，均为 1536 × 1024 WebP，已登记到原有分类。这些图片继续收录于默认池中。

## 标签说明

我检查了仓库公开 README：项目支持重复 `tag` 筛选，并允许管理员管理全局额外标签，但 README 没有列出完整的默认标签字典。因此 `manifest.json` 中的 `suggestedTags` 是按图片内容整理的建议标签，**不是已验证的项目内置标签**；接入前请与项目实际标签值对齐。

## 前端随机选择示例

```ts
import gallery from './manifest.json';

export function pickCoverByTags(tags: string[] = []) {
  const candidates = gallery.images.filter((item) =>
    tags.every((tag) => item.suggestedTags.includes(tag))
  );
  const pool = candidates.length ? candidates : gallery.images;
  return pool[Math.floor(Math.random() * pool.length)].src;
}
```

如果项目运行时使用的是数据库中的真实 tag，请将 `suggestedTags` 映射到实际标签，不要直接把建议标签当成已存在的 tag。

## 2026-11-14 多样化默认图

新增清蒸鲈鱼、宫保鸡丁、蒜蓉虾、凉拌黄瓜、麻婆豆腐、蒜蓉上海青、冰花煎饺、扬州炒饭、玉米排骨汤、银耳雪梨羹，共十张独立生成图，输出为 1200 × 800 WebP。

- `preview-diverse.jpg`：本次十张新图总览（从左至右、从上至下对应上面的顺序）。
- `generation-prompts-diverse.json`：每张完整提示词，使用内置 image_gen 单独生成。
- `manifest.json` 的 `keywords` 用于菜名匹配，`defaultPool` 标记无具体匹配时使用的图片；原先高度相似的 16 张餐桌图保留，但不再用于默认池。

手机、平板与桌面继续使用现有图片容器及 `object-fit` 裁切，不改变布局与动效。
