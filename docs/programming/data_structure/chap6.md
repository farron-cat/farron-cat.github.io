# 第六章 图
## 定义
- G=(V,E) V顶点集 E边集
    - V(G) 图G中顶点的有限非空集
    - E(G) 图G中顶点之间关系集
    - |V|图G中顶点个数
        - 也叫图G的阶
    - |E|图G中边的条数
- 图不可为空，因为其顶点集必须非空
- 无向图
    - 无向边，简称边 记(v,w)
    - w和v互为邻接点
    - (v,w)
    - 度
        - 一条边同时为两个顶点提供一个入度和一个出度
        - 全部顶点的度为边数二倍
- 有向图
    - 有向边，也叫做弧 记<v,w>
    - v弧尾，w弧头
    - <v,w>：v到w的弧（v邻接到w）
    - 度
        - 出度
        - 入度
        - 一条边为一个顶点提供一个入度同时为另一个节点提供出度
        - 入度=出度=边数
- 边的权
    - 权，边上含有意义的值
    - 带权图 也称网，边上有权的图
    - 带权路径长度
        - 途中某一路径的所有边的权的和
- 点到点关系
    - 路径 回路 简单路径 简单回路
        - 简单，路径上顶点不重复
        - 回路，路径上第一个顶点和最后一个顶点相同
    - 路径长度，路径上边的数目
    - 最短路径 点到点距离
        - 距离为最短路径长度
    - 无向图顶点连通性
        - 联通
        - 联通图
        - 联通分量 极大联通子图
    - 有向图顶点连通性
        - 强联通
        - 强联通图
        - 强联通分量 极大强联通子图
- 图的局部
    - 子图
        - 满足图定义
        - 边集，点集都为某一个图的子集，为该图的子图
    - 生成子图
        - 点集和某一个图的点集相同的子图，为该图的生成子图
    - 联通分量
        - 极大联通子图
    - 强联通分量
        - 极大强联通子图
    - 联通无向图的生成树
        - 包含全部顶点的极小联通子图
        - n个顶点的图，其生成树有n-1条边
    - 非联通无向图的生成森林
        - 各联通分量的生成树
- 特殊形态的图
    - 完全图
        - n(n-1)/2条边的无向图
        - n(n-1)条弧的有向图
    - 稠密图 稀疏图
        - 边数的多少来划分
    - 树 森林
    - 有向树
        - 一个顶点入度为0，其余顶点入度均为1的有向图
- 边数问题
    - 图 n个顶点
        - 边数小于n-1则为非联通
    - 非联通图 n个顶点
        - 边数最多n-1个顶点构成完全图
    - 有向强联通图 n个顶点
        - 边数最少n条边围成环路
## <font color=#DC2D1E>性质</font>
## 存储结构
- <font color=#40A8F5>邻接矩阵</font> ![图片](./第六章 图-幕布图片-12867-380456.jpg)
    - 顺序存储
    - 表示唯一
    - 存储顶点之间邻接关系的二维数组
    - 无向图和有向图表示的区别
    - 度的求法
    - 空间复杂度O(n^2)
    - 适合稠密图
    - 可以用对称矩阵压缩法压缩
    - 确定边数需要遍历
    - 邻接矩阵的n次方[i][j]位置的值代表由i到j的长度为n的结点的路径数目
- <font color=#40A8F5>邻接表</font> ![图片](./第六章 图-幕布图片-938971-878830.jpg)
    - 顺序存储和链式存储
    - 表示不唯一
        - 缘于边结点连接顺序任意
    - 顶点表和边表构成
    - 类比树的孩子表示法
    - 有向图
        - 空间复杂度
        - 缺点：求入度需要遍历
    - 无向图
        - 每条边对应两个结点，边结点数必为偶数
        - 空间复杂度
    - 度求法
        - 顶点表该节点后边表中结点数为出度
        - 表中所有该节点的边结点数为入度
    - 适合稀疏图
- <font color=#40A8F5>十字链表 表示有向图</font>
    - 解决有向图入度和入边不好计算
- <font color=#40A8F5>邻接多重表 表示无向图</font>
## <font color=#DC2D1E>基本操作</font>
- 理解操作逻辑
## <font color=#DC2D1E>遍历</font>
- 广度优先 BFS
    
- 深度优先 DFS
    
## <font color=#DC2D1E>应用</font>
- 最小生成树
    - 带权连通无向图G的生成树中，权值之和最小的生成树叫做最小生成树
    - 性质
        - 最小生成树不是唯一的，即树形不唯一；当G中各边权值互不相等时，G的最小生成树唯一
        - 最小生成树的边的权值之和总是唯一
        - 最小生成树的边数为定点数减一（树的性质）
    - 算法
        - Prim 选顶点
            - 适用于边稠密
            - 时间复杂度O(|V|^2)
        - Kruskal 选边
            - 适用于边稀疏且顶点较多
            - 时间复杂度O(|E|log|E|）
- 最短路径
    - BFS
        - 无向图的
    - Dijkstra
        - 求解单源最短路径
        - 辅助数组
        - 时间复杂度
        - 空间复杂度
    - Floyd
        - 求解每对顶点间的最短路径
        - 动态规划思想
        - 辅助数组
        - 时间复杂度
        - 空间复杂度
- 拓扑排序
    - AOV网
    - 拓扑排序判断图是否有环最快
- <font color=#DC2D1E>关键路径</font>
    - AOE网