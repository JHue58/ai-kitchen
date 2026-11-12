# AI Kitchen 厨房 SVG 图标库

这是一套面向 AI Kitchen React + TypeScript 前端的本地图标资源。

## 资源内容

- `icons/<category>/<id>.svg`：259 个独立 SVG 文件。
- `kitchen-sprite.svg`：包含全部图标的 SVG Sprite。
- `manifest.json`：图标 ID、中文名称、英文名称、分类、别名和检索关键词。
- `manifest.csv`：方便用 Excel / 表格软件查看和编辑的关键词清单。
- `preview.html`：可搜索、可按分类筛选的图标预览页。
- `KitchenIcon.tsx`：可复制到 React 项目的图标组件。

## 分类数量

- 炊具与烹饪工具：45
- 厨房电器：28
- 调味品：44
- 食材：81
- 菜品与食物：61

## 项目接入

本项目直接从 `frontend/resources` 导入，由 Vite 构建处理 URL，无需复制到 public。`KitchenIcon.tsx` 引用本目录的 Sprite，业务界面通过 `src/components/kitchen-icon.tsx` 按名称匹配炊具、食材、调料和菜品图标，未知名称使用通用图标。图标继承当前主题文字颜色。

## 其他项目的放置示例

将 `icons` 文件夹、`kitchen-sprite.svg` 和 `manifest.json` 复制到：

```text
frontend/public/icons/kitchen/
```

将 `KitchenIcon.tsx` 复制到前端组件目录，例如：

```text
frontend/src/components/KitchenIcon.tsx
```

## React 使用方式

推荐使用 Sprite 的 `<use>` 引用方式。图标使用 `currentColor`，会继承组件的文字颜色，因此可自动适配浅色 / 深色主题：

```tsx
import type { SVGProps } from 'react'

type KitchenIconProps = SVGProps<SVGSVGElement> & {
  name: string
}

export function KitchenIcon({ name, ...props }: KitchenIconProps) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" {...props}>
      <use href={`/icons/kitchen/kitchen-sprite.svg#${name}`} />
    </svg>
  )
}
```

调用示例：

```tsx
<KitchenIcon name="air-fryer" className="h-8 w-8 text-stone-700 dark:text-stone-200" />
```

也可以使用单独文件，例如：

```text
/icons/kitchen/icons/ingredients/tomato.svg
```

注意：单独 SVG 使用 `currentColor`。如果通过 `<img>` 加载，颜色不会继承外层 React 元素；需要主题换色时，优先使用 Sprite 的 `<use>` 方式。

## 关键词检索

`manifest.json` 中每个图标包含：

- `id`：稳定英文 ID，可用作组件参数和存储值。
- `name`：中文名称。
- `name_en`：英文名称。
- `category` / `category_label`：分类。
- `keywords`：中文名称、常见叫法、英文名称和英文 ID。

建议前端加载一次 `manifest.json`，对 `name`、`name_en`、`id` 和 `keywords` 做本地模糊匹配：

```ts
const response = await fetch('/icons/kitchen/manifest.json')
const catalog = await response.json()
const matches = catalog.items.filter((item: any) => {
  const text = [item.name, item.name_en, item.id, ...item.keywords]
    .join(' ')
    .toLowerCase()
  return text.includes(query.trim().toLowerCase())
})
```

关键词主要用于界面搜索、库存录入、AI 名称映射和图标匹配，不是完整的食物分类标准。用户自定义的炊具、调料和食材仍建议允许使用默认图标或通用占位图标。

## 视觉说明

- 统一 64 × 64 viewBox。
- 圆角线帽、圆角连接，简洁线性风格。
- 不带底色，适合放在卡片、标签、列表和选择器中。
- 使用 `currentColor`，由前端主题控制颜色。
