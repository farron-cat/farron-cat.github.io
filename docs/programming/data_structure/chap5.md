# 第五章 树与二叉树
## 树
- 逻辑结构 分层结构
- 根结点没有上层结点，n个结点的树有n-1条边
- 概念
    - 节点关系
        - 祖先
        - 子孙
        - 双亲
        - 孩子
        - 兄弟
        - 堂兄弟
    - 结点的度 树的度
    - 结点的深度 高度 树的高度
    - 有序树、无序树
    - 路径、路径长度 树的路径长度
    - 森林
- 性质
    - 结点数等于所有结点度数之和加1
    - 度为m的树中第i层上至多m^(i-1)个结点
    - 高度为h的m叉树至多 (m^h-1)/(m-1)个结点
    - 具有n个结点的m叉树最小高度为logm(n(m-1)+1)向上取整
## 二叉树
- 定义
    - 每个结点至多两棵子树
    - 子树有左右顺序，不能颠倒
    - 二叉树的五种基本形态
    - <font color=#40A8F5>二叉树与度为2的有序树的区别</font>
        - 度为2的树最少需要有3个结点，而二叉树可以为空
        - 度为2的树的孩子的左右次序是相对于另一个孩子的
    - <font color=#40A8F5>特殊二叉树</font>
        - 满二叉树
        - 完全二叉树
        - 二叉排序树
        - 平衡二叉树
- <font color=#DC2D1E>性质</font>
    - n0 = n2+1  结点数=边数+1 推出
    - i层最多2^(i-1)  h高满二叉树2^i-1
    - 完全二叉树从上到下从左到右编号
        - i>1 i的双亲i/2向下取整
    - 完全二叉树结点总数为n
        - n奇数 (n-1)/2是最后一个度为2的结点
        - n偶数 n/2是度为1的结点
        - 可由n推出n0、n1、n2
            - n偶数n1为1
            - n奇数n1为0
        - <font color=#75C940>高度</font>
            - <font color=#75C940>log2(n+1)向上取整</font>
            - <font color=#75C940>log2(n)向下取整+1</font>
    - <font color=#FFAF38>非空指针数=总分支数=n-1</font>
    - <font color=#FFAF38>空指针数=2*结点数-非空指针数=n+1</font>
- 存储结构
    - <font color=#40A8F5>顺序存储</font>
        - 为了能通过位序推断树的逻辑关系，对于一般二叉树需要将某些位置留空存储
        - 建议下标从1开始
    - <font color=#40A8F5>链式存储</font> ![图片](./第五章 树与二叉树-幕布图片-888556-833290.jpg)
- 遍历
    - 中序加剩余三者任意一个可以确定二叉树
    - 通过带空结点的先序遍历确定二叉树
    - 先序 ![图片](./第五章 树与二叉树-幕布图片-814674-412571.jpg)
    - 中序 ![图片](./第五章 树与二叉树-幕布图片-636846-680444.jpg)
    - 后序 ![图片](./第五章 树与二叉树-幕布图片-874702-328266.jpg)
    - 层序 ![图片](./第五章 树与二叉树-幕布图片-362560-590689.jpg)
    - <font color=#DC2D1E>非递归实现</font>
        - 前序 ![图片](./第五章 树与二叉树-幕布图片-675565-684442.jpg)
        - 中序 ![图片](./第五章 树与二叉树-幕布图片-54124-539482.jpg)
        - <font color=#DC2D1E>后序</font> ![图片](./第五章 树与二叉树-幕布图片-325679-102295.jpg)
- 线索二叉树 <font color=#75C940>（物理结构）</font>
    - 定义 ![图片](./第五章 树与二叉树-幕布图片-357132-594612.jpg)
    - 中序线索二叉树
        - 中序线索化 ![图片](./第五章 树与二叉树-幕布图片-249127-998521.jpg)
        - 中序线索二叉树构造 ![图片](./第五章 树与二叉树-幕布图片-315612-867924.jpg)
    - 先序线索二叉树
    - 后序线索二叉树
    - 注意
        - 在构造最后还要单独将最后一个结点的rtag设置为1
        - 先序线索二叉树构造过程中，注意当ltag==0时再递归进入左子树
    - <font color=#DC2D1E>运用线索的非递归遍历</font>
        - 中序遍历
            - 找到中序第一个结点 ![图片](./第五章 树与二叉树-幕布图片-816209-834115.jpg)
            - 中序下一个结点 ![图片](./第五章 树与二叉树-幕布图片-372518-881361.jpg)
            - 遍历 ![图片](./第五章 树与二叉树-幕布图片-164409-659284.jpg)
## 树和森林
- 定义
    - 树的路径长度是从树根到每个结点的路径长度的 <font color=#FFAF38>总和</font>
- <font color=#DC2D1E>性质</font>
- 存储结构
    - <font color=#40A8F5>双亲表示法</font> ![图片](./第五章 树与二叉树-幕布图片-907010-358170.jpg)
    - <font color=#40A8F5>孩子表示法</font> ![图片](./第五章 树与二叉树-幕布图片-600215-733176.jpg)
    - <font color=#40A8F5>孩子兄弟表示法</font> ![图片](./第五章 树与二叉树-幕布图片-948361-204059.jpg)
- <font color=#DC2D1E>遍历</font>
    - 树
        - 先根遍历
            -  ![图片](./第五章 树与二叉树-幕布图片-580552-776866.jpg)
        - 后根遍历
            -  ![图片](./第五章 树与二叉树-幕布图片-370888-71534.jpg)
        - 层序遍历
            -  ![图片](./第五章 树与二叉树-幕布图片-40386-43132.jpg)
    - 森林
        - 先序遍历森林
            -  ![图片](./第五章 树与二叉树-幕布图片-706312-378112.jpg) ![图片](./第五章 树与二叉树-幕布图片-913862-125801.jpg)
        - 中序遍历森林
            -  ![图片](./第五章 树与二叉树-幕布图片-2531-393294.jpg)
## 三者转换
- 三者遍历等价关系
    - 森林无后序遍历 ![图片](./第五章 树与二叉树-幕布图片-774125-16617.jpg)
## 应用
- 二叉排序树
    - 不能有重复的结点
    - 定义 ![图片](./第五章 树与二叉树-幕布图片-302407-977631.jpg)
        - <font color=#75C940>左<根<右</font>
        - 结点关键字 <font color=#75C940>不能重复</font>
    - 查找 ![图片](./第五章 树与二叉树-幕布图片-394403-823367.jpg)
    - 插入 ![图片](./第五章 树与二叉树-幕布图片-128237-924758.jpg)
    - 构建 ![图片](./第五章 树与二叉树-幕布图片-276730-972564.jpg)
    - <font color=#DC2D1E>删除</font>
        - 删除叶结点
        - 删除只有左子树的结点
            - 左子树根节点替换删除结点
        - 删除只有右子树的结点
            - 右子树根结点替换删除结点
        - 删除左右子树都有的结点
            - 用其左子树中的最右下结点替换删除结点，退化成删除只有左子树的结点的情况
            - 用其右子树中的最左下结点替换删除结点，退化成删除只有右子树的结点的情况
    - <font color=#DC2D1E>查找效率分析</font>
        - 取决于树的高度
            - 最好O(logh)
            - 最坏O(h)
        - 平均查找长度ASL （平均比较次数）
            - 成功时
            - 失败时
                - 注意失败处不需要比较
- <font color=#DC2D1E>平衡二叉树</font>
    - 定义
        - 任意结点的左子树与右子树高度之差不大于1
        - <font color=#FFAF38>平衡因子</font> =左子树高度-右子树高度
    - 插入
        - 插入时先检查其插入路径上的结点是否因此而不平衡
        - 不平衡则找到距插入位置 <font color=#75C940>最近的不平衡结点</font> ，操作以它为根的子树
    - 平衡 操作最小不平衡子树
        - LL 左孩子的左子树插入导致
            - 左孩子右旋
        - RR 右孩子的右子树插入导致
            - 右孩子左旋
        - LR 左孩子的右子树插入导致
            - 左孩子的右孩子左旋再右旋
        - RL 右孩子的左子树插入导致
            - 右孩子的左孩子右旋再左旋
        - 插入操作导致 <font color=#40A8F5>最小不平衡子树</font> 高度+1，经过调整后高度恢复
    - 查找
        - 同二叉排序树
    - <font color=#DC2D1E>分析</font>
        - 平均查找长度O(logn)
    - <font color=#DC2D1E>深度与结点个数的关系</font>
        - <font color=#75C940>n0=0，n1=1，n2=2</font>
        - <font color=#75C940>nh=n（h-1）+n（h-2）+1</font>
        - <font color=#75C940>高为h的avl最少结点数为nh</font>
        - <font color=#75C940>[nh,n(h+1))个结点的最大深度为h</font>
        - 最大深度O(logn)
- 哈夫曼树
    - 定义
        - 带权路径长度最小的二叉树
        - 权
        - 带权路径长度 WPL
            - 节点的带权路径长度
            - 树的带权路径长度，所有叶结点的带权路径长度的和
    - 构造方法
    - 权重结点在叶结点保证哈夫曼编码不会混淆
    - <font color=#DC2D1E>特点</font>
        - 初始点最终为叶结点，权值越小的结点到根结点的路径长度越大
        - <font color=#75C940>构造过程中新建了n-1个结点，总节点数2n-1</font>
        - 不存在度为1的点
    - 哈夫曼编码
    - <font color=#DC2D1E>m度的哈夫曼</font>
    - 概率范围计算问题
        - 越靠近树根的概率越大
        - 上层概率大于下层概率
- 并查集
    - 树的双亲表示，便于查根和合并
    - 基本操作
        - 查找
        - 合并
    - 秩：树高
    - 优化
        - 优化合并 小合并到大下方
            - 优化前查找O(h)或O(n)
            - 优化后查找变为O(logn)
        - 优化查找 压缩路径
            - 优化后查找O(α(n))，相当于O(1)
    - 应用
        - 判断图的联通分量数
        - 判断图是否有环
        - kruskal算法
- B树
    - 2-3-4树 4阶B树
- B+树