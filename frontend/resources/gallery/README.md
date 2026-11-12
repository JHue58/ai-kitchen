# AI Kitchen Food Gallery

## 本项目接入

原 `public/images/kitchen-table.jpg` 已迁入 `images/kitchen-table.jpg`，用于登录页、首页和最终兜底；它是装饰图，不计入下面的 17 张菜品图库。

`src/resources.ts` 按菜名优先、描述/标签/食材辅助匹配类别；番茄炒蛋使用专用图，同一菜名固定选择图片。建议标签仅用于前端图片匹配，不会写入业务标签字典。

菜品列表、菜单封面和详情优先显示 AI 提供的有效 HTTP(S) 图片；缺图、加载失败或尺寸不足时使用图库，详情标注为默认示意图。资源由 Vite 输出到构建目录，无需额外复制 public 文件。

本包包含 21 张独立 WebP 菜品展示图，延续项目当前暖木桌、米色亚麻、浅色陶瓷餐具与自然窗光的家常美食摄影风格。

## 目录

- `images/meat-braises/`：家常荤菜、红烧炖菜（5 张）
- `images/vegetables-eggs-tofu/`：蔬菜、蛋类、豆制品（5 张）
- `images/noodles-staples/`：面食、饺子、主食（5 张）
- `images/soups-stews/`：汤羹、炖菜（5 张）
- `images/eggs/`：番茄炒蛋单菜近景（1 张）
- `manifest.json`：图片路径、分类、描述与建议标签
- `preview-expanded.jpg`：包含全部 21 张菜品图的最新总览；`preview.jpg` 保留原始总览。
- `generation-prompts.json`：2026-11-12 新增图片的完整提示词和风格参考，使用内置 image_gen 生成。

2026-11-12 新增香菇烧鸡、家常豆腐、葱油拌面、冬瓜肉丸汤各一张，均为 1536 × 1024 WebP，已登记到原有分类。前端现有 `import.meta.glob` 与 `defaultDishPhoto` 会自动收录这些图片。

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
