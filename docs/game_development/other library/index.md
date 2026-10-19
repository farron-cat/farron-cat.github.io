# 其他库

游戏开发中常用的 C++ 第三方库，记录安装配置与使用示例。

| 库 | 用途 | 入口 |
| --- | --- | --- |
| GLM | 基于 GLSL 语法的数学库，用于向量/矩阵运算 | [阅读](./glm) |
| nlohmann json | 现代 C++ JSON 解析与序列化 | [阅读](./nlmajson) |
| spdlog | 高性能、header-only 的日志库 | [阅读](./spdlog) |

::: tip 共同点
三者都是 header-only（或易集成）的库，接入 CMake 时基本只需 `find_package` 或直接添加头文件路径。
:::
