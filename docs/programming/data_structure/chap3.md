# 第三章 栈和队列
## 栈
### 定义:
- 只允许在一端进行插入或删除操作的 <font color=#DC2D1E>线性表</font>
- 栈顶 栈底 空栈
- 后进先出 LIFO
### 基本操作:
- 创销
    - InitStack(&)
    - DestroyStack(&L)
- 增删
    - Push(&S,x)
    - Pop(&S,&x)
- 改查
    - GetTop(S,&x)
- 常用
    - StackEmpty(S)
### 存储结构:

#### <font color=#40A8F5>顺序栈</font>
##### 定义:
```c:line-numbers
//定义
typedef struct
{
    ElemType data[MaxSize];
    int top;
} SqStack;
```
- 栈顶指针top两种定义方法影响代码具体实现
    - top指向栈顶元素
    - top指向栈顶的元素的下一个存储单位
##### 基本操作:
初始化
```c:line-numbers
//初始化
void InitStack(SqStack &S)
{
    for (int i = 0; i < MaxSize; i++)
        S.data[i] = 0;
    S.top = -1;
}
```
入栈
```c:line-numbers
//入栈
bool Push(SqStack &S, ElemType x)
{
    if (S.top == MaxSize - 1)
        return false;
    S.top = S.top + 1; // 二合一 先加指针再填内容
    S.data[S.top] = x; // S.data[++S.top]=x;
    return true;
}
```
出栈
```c:line-numbers
//出栈
bool Pop(SqStack &S, ElemType &x)
{
    if (S.top == -1)
        return false;
    x = S.data[S.top]; // 二合一 先弹出内容再减指针
    S.top = S.top - 1; // x=S.data[S.top--];
    return true;
}
```
返回栈顶 
```c:line-numbers
//返回栈顶 同出栈无需移动指针
bool GetTop(SqStack &S, ElemType &x)
{
    if (S.top == -1)
        return false;
    x = S.data[S.top];
    return true;
}
```
判空
```c:line-numbers
//判空 栈顶指针指向-1
bool StackEmpty(SqStack &S)
{
    if(S.top == -1)
        return true;
    else
        return false;
}
```
##### 特点:
    null
#### <font color=#40A8F5>链栈</font>
##### 定义
```c:line-numbers
//定义
typedef struct LinkNode
{
    ElemType data;
    LinkNode *next;
} LinkNode, *LinkStack;
```
##### 基本操作
初始化
```c:line-numbers
//初始化 无头结点表示
void InitStack(LinkStack &S)
{
    S = NULL;
}
```
入栈  在表头进行
```c:line-numbers
//入栈
bool Push(LinkStack &S, ElemType x)
{
    LinkNode *node = (LinkNode *)malloc(sizeof(LinkNode));
    if (node == NULL)
        return false;
    node->data = x;
    node->next = S->next;
    S->next = node;
    return true;
}
```
出栈  在表头进行
```c:line-numbers
//出栈
bool Pop(LinkStack &S, ElemType &x)
{
    if (S == NULL)
        return false;
    LinkNode *p;
    x = S->data;
    p = S;
    S->next = p->next;
    free(p);
    return true;
}
```
返回栈顶
```c:line-numbers
//返回栈顶 同出栈不需要p指针标记删除结点并free
bool GetTop(LinkStack &S, ElemType &x)
{
    if (S == NULL)
        return false;
    x = S->data;
    return true;
}
```
判空  指针为空即为空栈
##### 特点


#### <font color=#40A8F5>共享栈 （特殊顺序栈）</font>
##### 定义
```c:line-numbers
//定义 左右二栈共享
typedef struct
{
    ElemType data[MaxSize];
    int left;
    int right;
} ShareStack;
```
##### 基本操作
初始化
```c:line-numbers
//初始化
void InitStack(ShareStack &S)
{
    for (int i = 0; i < MaxSize; i++)
        S.data[i] = 0;
    S.left = -1;
    S.right = MaxSize;
}
```
入栈
```c:line-numbers
//左入栈
bool LeftPush(ShareStack &S, ElemType x)
{
    if (S.left == S.right - 1)
        return false;
    S.left = S.left + 1;
    S.data[S.left] = x;
    return true;
}

//右入栈
bool RightPush(ShareStack &S, ElemType x)
{
    if (S.left == S.right - 1)
        return false;
    S.right = S.right - 1;
    S.data[S.right] = x;
    return true;
}
```

出栈
```c:line-numbers
//左出栈
bool LeftPop(ShareStack &S, ElemType &x)
{
    if (S.left == -1)
        return false;
    x = S.data[S.left];
    S.left = S.left - 1;
    return true;
}


//右出栈
bool RightPop(ShareStack &S, ElemType &x)
{
    if (S.right == MaxSize)
        return false;
    x = S.data[S.right];
    S.right = S.right + 1;
    return true;
}
```
返回栈顶
```c:line-numbers
//左返回栈顶
bool LeftGetTop(ShareStack &S, ElemType &x)
{
    if (S.left == -1)
        return false;
    x = S.data[S.left];
    return true;
}

//右返回栈顶
bool RightGetTop(ShareStack &S, ElemType &x)
{
    if (S.right == MaxSize)
        return false;
    x = S.data[S.right];
    return true;
}
```
判空
- 左-1为空
- 右MaxSize为空
栈满
- 左 == 右 - 1
##### 特点
### 其他
- 用非递归重写递归函数不一定要用到栈
    - 斐波那契数列的迭代法用一个循环即可
- 栈只可能发生上溢


## 队列
### 定义
### 基本操作
### 存储结构
#### <font color=#40A8F5>顺序队列</font> <font color=#DC2D1E>(循环队列)</font>
##### 定义
```c:line-numbers
//定义
typedef struct
{
    ElemType data[MaxSize];
    int front, rear;
} SqQueue;
```
##### 基本操作
- 初始化
```c:line-numbers
//初始化
void InitQueue(SqQueue &Q)
{
    Q.front = Q.rear = 0;
}
```
- 入队
```c:line-numbers
//入队
bool EnQueue(SqQueue &Q, ElemType x)
{
    if ((Q.rear + 1) % MaxSize == Q.front)//队满错误
        return false;
    Q.data[Q.rear] = x;
    Q.rear = (Q.rear + 1) % MaxSize;//循环加一
    return true;
}
```
- 出队
```c:line-numbers
//出队
bool DeQueue(SqQueue &Q, ElemType &x)
{
    if (Q.front == Q.rear)//队空错误
        return false;
    x = Q.data[Q.front];
    Q.front = (Q.front + 1) % MaxSize;//循环加一
    return true;
}
```
- 判空
```c:line-numbers
//判空
bool isEmpty(SqQueue Q)
{
    if (Q.front == Q.rear)//首尾重合则队空
        return true;
    else
        return false;
}
```
##### 特点
- 队尾指针rear指向队尾元素后一个位置时
    - 判空条件：首 == 尾
    - 判满条件：尾循环加一 == 首
        - Q.rear = (Q.rear + 1) % <font color=#FFAF38>MaxSize       模空间的长度，注意题中数组开始和结束下标</font>
- 队尾指针rear指向队尾元素时
    - 队空和队满都为：尾循环加一==首
    - 要借助size或者tag（如下）
- <font color=#DC2D1E>避免浪费一个元素空间的方法</font>
    - 设置变量size记录队列大小
    - 设置变量 <font color=#40A8F5>tag</font> 记录最近进行的操作（删除0/插入1）
        - 队空：front==rear && <font color=#40A8F5>tag==0</font>
        - 队满：front==rear && <font color=#40A8F5>tag==1</font>
- rear队尾指针指向队尾元素时
#### <font color=#40A8F5>链队列</font>
##### 定义
```c:line-numbers
//定义
typedef struct LinkNode
{
    ElemType data;
    struct LinkNode *next;
} LinkNode;

typedef struct
{
    LinkNode *front, *rear;
} LinkQueue;
```
##### 基本操作
初始化
```c:line-numbers
//初始化
void InitQueue(LinkQueue &Q)
{
    Q.front = Q.rear = (LinkNode *)malloc(sizeof(LinkNode));
    Q.front->next = NULL;
}
```
入队
```c:line-numbers
//入队
bool EnQueue(LinkQueue &Q, ElemType x)
{
    LinkNode *s = (LinkNode *)malloc(sizeof(LinkNode));
    if (s == NULL)
        return false;
    s->data = x;
    s->next = NULL;
    Q.rear->next = s;
    Q.rear = s;
    return true;
}
```
出队 
```c:line-numbers
//出队
bool DeQueue(LinkQueue &Q, ElemType &x)
{
    if (Q.front == Q.rear)//队空错误
        return false;
    //p指针标记弹出结点
    LinkNode *p = Q.front->next;
    x = p->data;
    Q.front->next = p->next;
    if (Q.rear == p)//p为队尾的特殊情况
        Q.rear = Q.front;
    free(p);
    return true;
}
```
判空
```c:line-numbers
//判空
bool isEmpty(LinkQueue &Q)
{
    if (Q.front == Q.rear)
        return true;
    else
        return false;
}
```
##### 特点
:::tip
- 循环单链表做队列的想法
    - 带头节点
        - 只设置链表尾指针，头处插入删除都方便，尾处插入方便：让链表尾为队列尾，链表头为队列头
        - 只设置链表头节点，头处插入删除都方便，尾处插入删除都为O(n)
    - 不带头节点
        - 只设置链表尾指针，头处删除方便，尾处插入方便：让链表尾为队列尾，链表头为队列头
- 循环双链表做队列的想法
    - 带不带头节点在链表头尾插入和删除都方便O(1)，怎么做队列头尾都行
:::
#### <font color=#40A8F5>特殊队列（双端队列）</font>
输出受限的双端队列
输入受限的双端队列


## <font color=#DC2D1E>应用</font>
### 栈
#### 括号匹配
- 思路来源
    - 最后出现的左括号最先被右括号匹配，符合栈的后进先出
- 不匹配的情况
    - 左右括号匹配过程中类型不同
    - 右括号单身：栈空后仍有括号需要匹配
    - 左括号单身：括号匹配完后栈内仍有括号
- 算法
    - 流程图
#### 表达式求值
- 三种算数表达式
    - 前缀表达式（波兰式）
    - > - +ab *cd
    - 中缀表达式
    - > a+b-c*d
    - <font color=#DC2D1E>后缀表达式（逆波兰式）</font>
    - > ab+ cd* -
- 考点 
    - 中缀转前缀 
        - “右优先原则”
    - 中缀转后缀
        - 保证手算与机算一致，机算算法应具有确定性，在确定运算符生效顺序时应采用“左优先原则”
    - 前缀求值
        - 自右向左扫描
    - 后缀求值 
        - 自左向右扫描
#### 递归
- 递归模型
    - 递归表达式（递归体）、递归出口（边界条件）
- 函数递归调用栈
    - 实参、局部变量、返回点（调用返回地址）
- 递归次数过容易造成栈溢出、效率不高是因为有大量重复计算
- =
### 队列
- 层次遍历
- 计算机系统
### 算法
- 栈模拟队列
- 队列模拟栈
### <font color=#DC2D1E>※ 特殊矩阵的压缩存储</font>
- 数组
- 数组的存储结构
    - 一维数组
    - 二维数组
        - 行优先
        - 列优先
    - 矩阵压缩存储
        - 对称矩阵
        - 三角矩阵
        - 三对角矩阵
        - 稀疏矩阵