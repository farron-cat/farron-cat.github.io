# 第二章 线性表 Linear List
## 定义
- 具有 <font color=#FFAF38>相同数据类</font> <font color=#FFAF38>型</font> 的n个数据元素的 <font color=#40A8F5>有限</font> <font color=#DC2D1E>序列</font> (有次序)
    - n为表长 n=0时为空表
- 表示: L <font color=#75C940>(a1</font> ,a2,...,ai,... <font color=#75C940>an</font> )
    - i为位序 <font color=#DC2D1E>从1开始</font>


## <font color=#DC2D1E>顺序表</font>
**用顺序存储的方式实现的线性表** 

静态分配
```c
#define MaxSize 10
typedef int ElemType;
typedef struct
{
    ElemType data[MaxSize];
    int length;
} SqList;
```
动态分配
```c
#define InitSize 10
typedef int ElemType;
typedef struct
{
    ElemType *data;
    int max_size;
    int length;
} SqList;
```
动态分配的扩容 
```c
void IncreaseSize(SqList &L, int len)
{
    int *p = L.data;
    L.data = (ElemType *)malloc((L.max_size + len) * sizeof(ElemType));
    for (int i = 0; i < L.length; i++)
        L.data[i] = p[i];
    L.max_size += len;
    free(p);
}
```

**基本操作: (静态)**

初始化:
```c
void InitList(SqList &L)
{
    for (int i = 0; i < MaxSize; i++)
        L.data[i] = 0;
    L.length = 0;
}
```

插入:
```c
bool ListInsert(SqList &L, int i, ElemType e)
{
    if (i < 1 || i > L.length + 1)
        return false;
    if (L.length >= MaxSize)
        return false;
    for (int j = L.length; j >= i; j--)
        L.data[j] = L.data[j - 1];
    L.data[i - 1] = e;
    L.length++;
    return true;
}
```
- i是位序，它范围是从1~length，插入位置其实为数组的i-1位置，j应从length~i，保证最后一次将插入位置i-1的内容移动到i处(即j>=i）
- 分析
    - 最好：O(1)
    - 最坏：O(n)
    - 平均：O(n)
        - (n+n-1+n-2+...+0)*(1/(n+1))

删除:
```c
bool ListDelete(SqList &L, int i, ElemType &e)
{
    if (i < 1 || i > L.length + 1)
        return false;
    e = L.data[i];
    for (int j = i; j < L.length; j++)
        L.data[j - 1] = L.data[j];
    L.length--;
    return true;
}
```
- i合法位置为1~length
- 删除位序i，实际上删除数组i-1处元素，j从i~length-1，将j处移到j-1处
- 分析
    - 最好：O(1)
    - 最坏：O(n)
    - 平均：O(n)
        - (n-1+n-2+...+0)*(1/(n))

查找:

按位查找
```c
ElemType GetElem(SqList L, int i)
{
    if (i < 1 || i > L.length)
        return -1;
    return L.data[i - 1];
}
```
- 分析
    - 最好：O(1)
    - 最坏：O(1)
    - 平均：O(1)

按值查找
```c
int LocateElem(SqList L, ElemType e)
{
    for (int i = 0; i < L.length; i++)
        if (L.data[i] == e)
            return i;
    return 0;
}
```
- 分析
    - 最好：O(1)
    - 最坏：O(n)
    - 平均：O(n)


**特点**
- 随机访问
- 存储密度高
- 扩展容量不方便
- 插入删除数据不方便


## <font color=#DC2D1E>链表</font>
用<font color=#DC2D1E>链式存储</font>的方式实现线性表

### <font color=#40A8F5>单链表</font>
1.定义
```c
typedef int ElemType;
typedef struct LNode
{
    ElemType data;
    struct LNode *next;
} LNode, *LinkList;
```

2.初始化:

带头  判空条件:L->next == NULL
```c
bool InitList(LinkList &L)
{
    L = (LNode *)malloc(sizeof(LNode));
    if (L == NULL)
        return false;
    L->next = NULL;
    return true;
}
```
不带头 判空条件:L==NULL 
```c
bool InitList(LinkList &L)
{
    L = NULL;
    return true;
}
```
3.插入:

指定结点后插 
```c
//指定结点后插 O(1)
bool InsertNextNode(LNode *p, ElemType e)
{
    if (p == NULL)
        return false;

    LNode *node = (LNode *)malloc(sizeof(LNode));
    if (node == NULL)
        return false;

    node->data = e;
    node->next = p->next;
    p->next = node;
    return true;
}
```
<font color=#40A8F5>指定结点前插</font> 

```c
//指定结点前插 O(1)
bool InsertPriorNode(LNode *p, ElemType e)
{
    if (p == NULL)
        return false;

    LNode *node = (LNode *)malloc(sizeof(LNode));
    if (node == NULL)
        return false;

    node->next = p->next;
    p->next = node;
    //将插入结点值换为p结点值，p结点值设为e
    node->data = p->data;
    p->data = e;
    return true;
}
```
- 先将新建节点插入p之后，将p节点值赋给新节点，再将e赋给p节点，从而实现逻辑上的前插

指定位序插入  （可以复用结点插入函数）
带头结点 
```c
//带头 指定位序插入
bool ListInsert(LinkList &L, int i, ElemType e)
{
    if (i < 1)
        return false;

    LNode *p = L;
    int j = 0;
    //按位序查找i-1处结点 循环完毕j==i-1
    while (p != NULL && j < i - 1)
    {
        p = p->next;
        j++;
    }
    if (p==NULL)
        return false;
    //i超出最后一个结点
    return InsertNextNode(p, e);
}
```
- 头节点位序为0，在位序i处插入，实际上是在第i-1个节点处后插
- p==NULL说明插入位置i>链表长度+1

不带头结点 
```c
//不带头 指定位序插入
bool ListInsert(LinkList &L, int i, ElemType e){
    if (i < 1)
        return false;
    //头位置插入需要特殊处理
    if(i==1){
        LNode *node = (LNode *)malloc(sizeof(LNode));
        node->next = L;
        node->data = e;
        L=node;
        return true;
    }

    LNode *p = L;
    int j = 1;
    //循环完毕j==i-1
    while (p != NULL && j < i - 1)
    {
        p = p->next;
        j++;
    }
    //i超出最后一个结点
    return InsertNextNode(p,e);
}
```
- 对i==1特殊处理（i==1时头指针指向会改变）

4.建立:

核心：链表初始化、指定结点后插
尾插法建立
```c
//带头 尾插建立 O(n)
LinkList List_TailInsert(LinkList &L)
{
    int x;
    L = (LinkList)malloc(sizeof(LNode));
    L->next = NULL;   //只要初始化单链表，都先把头指针指向NULL
    LNode *s, *r = L; //r指针指向表尾结点
    scanf("%d", &x);
    while (x != 9999) //输入9999时停止插入
    {
        s = (LNode *)malloc(sizeof(LNode));
        s->data = x;
        r->next = s;
        r = s;
        scanf("%d", &x);
    }
    r->next = NULL;
    return L;
}
```
- 先初始化头节点，用rear指针记录最后节点位置，然后创建新节点并将新节点插入rear之后，更新rear位置

头插法建立 
```c
//带头 头插建立（可以实现链表逆置）
LinkList List_HeadInsert(LinkList &L)
{
    int x;
    L = (LinkList)malloc(sizeof(LNode));
    L->next = NULL; //只要初始化单链表，都先把头指针指向NULL
    LNode *s;
    scanf("%d", &x);
    while (x != 9999) //输入9999时停止插入
    {
        s = (LNode *)malloc(sizeof(LNode));
        s->data = x;
        s->next = L->next;
        L->next = s;
        scanf("%d", &x);
    }
    return L;
}
```
- 每次都在头节点后插入
- 头插最后与输入反序


5.删除:

删除指定位序
```c
//带头 删除指定位序 O(n)
bool ListDelete(LinkList &L, int i, ElemType &e)
{
    if (i < 1)
        return false;

    LNode *p = L;
    int j = 0;
    //循环完毕j==i-1 p指向被删结点直接前驱结点
    while (p != NULL && j < i - 1)
    {
        p = p->next;
        j++;
    }

    if (p == NULL)
        return false;
    if (p->next == NULL)
        return false;

    LNode *q = p->next;
    e = q->data;
    p->next = q->next;
    free(q);
    return true;
}
```
- 删除i处，要在i-1处操作

删除指定节点
```c
//带头 删除指定结点 O(1) 指定结点p不能为尾结点
bool DeleteNode(LNode *p)
{
    if (p == NULL)
        return false;
    if (p->next == NULL)
        return false;

    LNode *q = p->next;
    //将p后继结点值赋予p，然后删除p的后继
    p->data = q->data;
    p->next = q->next;
    free(q);
    return true;
}
```
- 通过将p后继节点值赋给p并删除p的后继来实现
- 要删除尾节点需要知道头指针，从头到尾遍历确定尾节点的前驱节点位置，然后再删除尾节点


6.查找:

按值查找
```c
//带头 按值查找 O(n)
LNode *LocateElem(LinkList L, ElemType e)
{
    LNode *p = L->next;
    while (p != NULL & p->data != e)
    {
        p = p->next;
    }
    return p;
}
```
按位序查找
```c
//带头 按位序查找 O(n)
LNode *GetElem(LinkList &L, int i)
{
    if (i < 0)
        return NULL;
    if (i == 0)
        return L;
    int j = 1;
    LNode *p = L->next;
    while (p != NULL && j < i)
    {
        p = p->next;
        j++;
    }
    return p;
}
```
- 循环结束时j=i
- 没写完，少返回p


7.常用操作:

求表长
```c
//带头 求表长
int Length(LinkList L)
{
    LNode *p = L->next;
    int j = 1;
    while (p)
    {
        p = p->next;
        j++;
    }
    return j;
}
```
求倒数第k个节点的值
- 用双指针，快指针比慢指针多走k个（慢加k等于快），同时走，快指针到末尾时慢指针位置即为所求

单链表就地逆置

反向输出单链表的值
- 递归
- 辅助栈


### <font color=#40A8F5>双链表</font>
- 定义 ![图片](./第二章 线性表-幕布图片-77486-142298.jpg)
- 初始化 ![图片](./第二章 线性表-幕布图片-596077-728859.jpg)
- 插入（后插） ![图片](./第二章 线性表-幕布图片-25215-89511.jpg)
    - 前插是前驱节点的后插
- 删除（后删） ![图片](./第二章 线性表-幕布图片-658232-305355.jpg)
- 遍历 ![图片](./第二章 线性表-幕布图片-806400-821173.jpg)
- 双链表插入和删除p时，要考虑p是否为尾节点

### <font color=#40A8F5>循环链表</font>
- <font color=#40A8F5>循环单链表</font>
    - 经常在头尾操作时，L指向尾结点较好，L指向尾节点时找到头节点的时间复杂度为O(1)
    - 定义 ![图片](./第二章 线性表-幕布图片-599180-355193.jpg)
    - 初始化（带头） ![图片](./第二章 线性表-幕布图片-734972-435118.jpg)
    - 判空 ![图片](./第二章 线性表-幕布图片-594820-264401.jpg)
    - 判尾 ![图片](./第二章 线性表-幕布图片-62123-474577.jpg)
- <font color=#40A8F5>循环双链表</font>
    - 定义 ![图片](./第二章 线性表-幕布图片-190631-590164.jpg)
    - 初始化 ![图片](./第二章 线性表-幕布图片-217636-425089.jpg)
    - 判空 ![图片](./第二章 线性表-幕布图片-74516-769182.jpg)
    - 判尾 ![图片](./第二章 线性表-幕布图片-281049-951546.jpg)
    - 指定结点后插 ![图片](./第二章 线性表-幕布图片-938877-900400.jpg)
    - 删除指定结点 ![图片](./第二章 线性表-幕布图片-844792-153579.jpg)
    - 循环双链表无须考虑p为尾节点的插入删除问题
- 边界细节
    - 判空
    - 判断表头、表尾
    - 如何在表中、表头、表尾插入和删除节点

### <font color=#40A8F5>静态链表</font>
- 定义
    - 定义1 ![图片](./第二章 线性表-幕布图片-757826-433848.jpg)
    - 定义2 ![图片](./第二章 线性表-幕布图片-781090-200450.jpg)
    - next==-1为尾
    - next==-1为空
    - <font color=#DC2D1E>操作</font>
        - 插入和删除 ![图片](./第二章 线性表-幕布图片-301576-300431.jpg)

## <font color=#DC2D1E>顺序表和链表的对比</font>
- 思路：
    - 定义
    - 同与不同
    - 从基本操作 创销 增删查改 思考区别 ![图片](./第二章 线性表-幕布图片-402343-481195.jpg) ![图片](./第二章 线性表-幕布图片-612626-551236.jpg)