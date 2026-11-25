# PSTE 论文主页

这是用于 GitHub Pages 的独立静态站点。页面及展示资源使用相对路径，可部署到账号主页或项目子路径。

## 本地预览

双击 `index.html` 可查看摘要、图表和实拍视频。交互仿真需要通过 HTTP 加载 WebAssembly 和策略文件。在工作区根目录运行下面的命令。

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory pste-project-page
```

服务运行后，用支持 WebGL 2 和 WebAssembly 的浏览器打开 [本地仿真](http://127.0.0.1:8765/#simulation)。仿真区域进入视野后会自动运行混合地形。首次启动会加载约 29 MB 的本地运行库、策略和 RobotA 网格。网页通过 MuJoCo 和 ONNX Runtime Web 在浏览器里直接运行仿真。机器人抵达终点后会短暂显示本轮成绩，然后回到同一赛道起点继续运行。

## 部署到 GitHub Pages

1. 将 `index.html`、`styles.css`、`README.md`、`.nojekyll`、`assets/` 和 `simulation/` 上传到用于发布的 GitHub 仓库根目录，或上传到现有仓库的 `docs/` 目录。
2. 在仓库的 **Settings → Pages** 下选择 **Deploy from a branch**。
3. 选择上传文件所在的分支，再选择相应的 **/(root)** 或 **/docs** 并保存。部署完成后，Pages 设置页会显示访问地址。

[GitHub Pages 发布源说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

部署文件不包含论文 PDF。主页通过 `noindex, nofollow` 请求支持该规则的搜索引擎不收录页面，也不跟踪页面上的链接。公开站点仍可通过网址直接访问。

## 内容来源

- 方法框图取自论文 PDF 的 Fig. 2，站点使用压缩后的 WebP。
- 十六组实拍素材左侧为 1× 原速，右侧为同一片段的 0.4× 慢放。RobotB 依次展示上楼梯、跨越 60 厘米壕沟、登上 30 厘米高台和下楼梯。RobotA 的上下楼梯各有一行计时演示。
- RobotA 奖励表按 Task、Safe and Soft 和 Style 编组，列出 33 项当前正式消融奖励的公式、权重和适用条件。
- 内容组织参考了 [MTSRL](https://sucro-legged.github.io/MTSRL/)，交互仿真参考了 [Extreme Parkour](https://extreme-parkour.github.io/)。

## 网页仿真

- 仿真策略由 `simulation/models/encoder.onnx` 和 `actor.onnx` 组成。RobotA 动力学使用实机对应的惯量、碰撞几何、关节、执行器和相机参数。可视模型 `simulation/models/robot-a-visual.glb` 包含机身与腿部网格。
- 每步的前进速度指令固定为 **4.5 m/s**，偏航指令用于保持赛道朝向。越过第一个障碍的前缘时开始计时。运行结束后，显示从该位置到结束位置的净前进位移除以对应仿真耗时所得的平均速度。物理步长为 2 ms，近距视觉、动作推理为 50 Hz，远距更新为 10 Hz。
- 连续楼梯、壕沟和混合地形的平地助跑距离为 10 米。独立高台场景的助跑距离为 12 米，随后是三个 40 厘米高台，相邻高台之间有 4 米平地。深度由相机对场景碰撞盒进行射线求交得到，论文中的定量结果来自其单独的仿真实验。
- 运行库随站点提供。版本为 MuJoCo 4.0.1、ONNX Runtime Web 1.23.2 和 Three.js 0.180.0。
