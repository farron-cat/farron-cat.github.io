# 08 · DMA 直接存储器存取 · 学习笔记

> 这一篇覆盖 **6 次提交**，分两组：`0c40272` → `86263f2` → `3085f3a`（**main 分支**，内存到内存 M2M），`57be122` → `af0741c` → `90e109f`（**`dma_usart` 分支**，串口收发交给 DMA）。
> `3085f3a` 曾是 `main` 分支的 HEAD（后来被 RTC、看门狗等提交顶替，见第 11、12 篇）。`dma_usart` 分支**尚未合并回 main**。
> 整理日期：2026-09-23（2026-09-26 复核，`main` HEAD 已变为 `bbce6b7`）　｜　提交范围：`0c40272`、`86263f2`、`3085f3a`、`57be122`、`af0741c`、`90e109f`

## 怎么读这份笔记

| 你的情况 | 建议路线 |
| --- | --- |
| 只想搞懂 DMA 怎么用 | 第二章（参数结构体）+ 第三章（M2M 三步走）+ 第九章速查表 |
| DMA 使能了但不搬数据 | 第八章排查清单第 1、2 条（通道映射 / 子外设选错） |
| 想把串口收发做成 DMA | 第五章（M2P）+ 第六章（P2M），这是本模块的精华 |
| 想理解「句柄化」的威力 | 第七章——**给结构体加 7 个字段，就多支持了一个串口 DMA** |

## 知识点地图

```
DMA 直接存储器存取
├── 为什么需要 DMA       CPU 逐个字节搬运 vs DMA 硬件自动搬运
├── 控制器与通道         DMA0 / DMA1 各 8 通道，共 16；M2M 只有 DMA1 支持
├── 通道映射（查表）     外设请求线硬件固定，选错通道 = 静默失败
├── 子外设选择            dma_channel_subperipheral_select()，串口用 DMA_SUBPERI4
├── 参数结构体            dma_single_data_parameter_struct 的 7 个字段
├── 三种传输方式          M2M / M2P（发送）/ P2M（接收）
├── 自增长（inc）         地址要不要每次 +1，方向决定一切
├── 传输完成中断          DMA_INT_FTF，标志位要清
├── 动态配置              地址和长度留到运行时再填（本工程 M2M 的核心）
├── M2P 发送              内存 → 串口数据寄存器，靠 TBE 请求搬运
├── P2M 接收              串口数据寄存器 → 内存，靠 RBNE 请求搬运
├── 剩余长度反推           dma_transfer_number_get() 算出收到多少字节
└── 句柄扩展              给 USART_HandleTypeDef 加 7 个 DMA 字段
```

## 学习目标

- 说清楚 DMA 存在的意义，以及「不用 DMA」时 CPU 在做什么
- 会查通道映射表，并记住**选错通道的后果是「静默失败」**
- 能背下 DMA 配置的 7 个字段，并理解 `direction`、`inc`、`width` 三者的联动关系
- 掌握 M2M / M2P / P2M 三种传输在代码上的差异
- 理解「动态配置」的价值：为什么地址和长度可以事后才填
- 看懂串口 DMA 接收里「用剩余长度反推收到多少字节」这个技巧

---

## 一、为什么需要 DMA

### 1.1 不用 DMA 时，CPU 在干什么

回忆第 04 篇的 `send_data()`：

```c
void send_data(USART_HandleTypeDef *huart, uint8_t *data, uint32_t len)
{
    while (data && len--)
    {
        send_byte(huart, *data);      // ① 写数据寄存器 ② 死等 TBE 标志位
        data++;
    }
}
```

发 1024 字节，CPU 要做这些事**1024 次**：

```
读内存里的一个字节 → 写进 USART 数据寄存器 → 循环检查 TBE 标志 → 下一个字节
     ↑                    ↑                        ↑
     └────────────── 全是 CPU 亲自动手 ──────────────┘
```

**代价算得出来**：115200 bps 下发 1024 字节要 88.8 ms。这 88.8 ms 里 CPU **大部分时间在空转等标志位**——不是算不过来，是**被一个慢速外设拴住了**。

### 1.2 DMA 的方案

**DMA（Direct Memory Access，直接存储器存取）** 是一块**专职搬数据的硬件**。你只需要告诉它：**从哪搬、搬到哪、搬多少个**，然后：

```c
// 告诉 DMA：把 data 的 len 个字节搬到串口数据寄存器
dma_memory_address_config(DMA1, DMA_CH7, DMA_MEMORY_0, (uint32_t)data);
dma_transfer_number_config(DMA1, DMA_CH7, len);
dma_channel_enable(DMA1, DMA_CH7);        // 启动，然后 CPU 就可以走了
```

之后 **DMA 自己一个字节一个字节地搬**，CPU 回去干别的事。搬完了可以选择**触发一次中断**告诉你「搬完了」。

| | CPU 搬运 | DMA 搬运 |
| --- | --- | --- |
| 每个字节都要 CPU 参与 | 是 | **否** |
| 搬运期间 CPU 能否干别的 | 不能 | **能** |
| 速度 | 受软件循环限制 | 硬件级，快 |
| 代码复杂度 | 简单 | 稍复杂（要配 7 个参数） |

**一句话理解**：**DMA 是给外设配的「搬运工」，让 CPU 从「扛包」变成「指挥」。**

### 1.3 GD32F4 的 DMA 资源

| 控制器 | 通道数 | 特别之处 |
| --- | --- | --- |
| DMA0 | 8（CH0~CH7） | — |
| DMA1 | 8（CH0~CH7） | **只有它支持存储器到存储器（M2M）** |

代码里这句话就是这个意思：

```c
rcu_periph_clock_enable(RCU_DMA1); // 只有DMA1支持m2m
```

**为什么 M2M 只有 DMA1 能？** 普通传输都有「外设」发请求信号（比如串口说「我准备好收下一个字节了」），而内存之间搬运**没有任何外设来发这个请求**，得 DMA 控制器自己产生。只有 DMA1 的通道具备这个能力。

### 1.4 通道映射：外设的请求线是焊死的

**外设的 DMA 请求固定连到某个控制器的某个通道**，不能随便选——就像插头和插座必须匹配。

本工程用到的四条（**这是本篇最重要的表**）：

| 用途 | 控制器 | 通道 | 子外设 | 出现在 |
| --- | --- | --- | --- | --- |
| **USART0_TX**（内存→串口） | DMA1 | **CH7** | `DMA_SUBPERI4` | `57be122`、`90e109f` |
| **USART0_RX**（串口→内存） | DMA1 | **CH5** | `DMA_SUBPERI4` | `af0741c`、`90e109f` |
| **USART2_TX** | DMA0 | **CH3** | `DMA_SUBPERI4` | `90e109f` |
| **USART2_RX** | DMA0 | **CH1** | `DMA_SUBPERI4` | `90e109f` |
| M2M 测试（任意通道） | DMA1 | CH0 | — | `0c40272`~`3085f3a` |

> **选错通道的后果是「静默失败」**：`dma_channel_enable()` 之后什么都不发生，不报错、不置标志、不进中断。**这是 DMA 最难查的一类问题**，所以配完第一件事就是确认通道号。
>
> 完整映射表见参考笔记 `DMA.md` 第 2.2 节。

### 1.5 三种传输方式

| 方式 | 缩写 | 方向 | 本工程场景 |
| --- | --- | --- | --- |
| 存储器 → 存储器 | **M2M** | 内存 → 内存 | `0c40272`~`3085f3a` 测试/数据拷贝 |
| 存储器 → 外设 | **M2P** | 内存 → 串口 | `57be122` 串口发送 |
| 外设 → 存储器 | **P2M** | 串口 → 内存 | `af0741c` 串口接收 |

---

## 二、参数结构体：7 个字段逐个说清

```c
dma_single_data_parameter_struct init_struct;
dma_single_data_para_struct_init(&init_struct);      // 先填默认值
```

| # | 字段 | 含义 | 关键点 |
| --- | --- | --- | --- |
| 1 | `direction` | 传输方向 | `DMA_MEMORY_TO_MEMORY` / `DMA_MEMORY_TO_PERIPH` / `DMA_PERIPH_TO_MEMORY` |
| 2 | `periph_addr` | 「外设」侧地址 | **M2M 时它被借去当「源地址」** |
| 3 | `memory0_addr` | 内存侧地址 | M2M 时是「目的地址」 |
| 4 | `periph_memory_width` | 每次搬几 bit | `DMA_PERIPH_WIDTH_8BIT` / `16BIT` / `32BIT` |
| 5 | `number` | 搬多少个 | 传输数量（次数，不是字节数） |
| 6 | `periph_inc` / `memory_inc` | 地址要不要自增 | 决定「搬完一个 → 地址 +N 还是不动」 |
| 7 | `circular_mode` / `priority` | 循环模式 / 优先级 | 循环模式用于连续采集；优先级低/中/高/超高 |

### 2.1 三条「配套规则」（最容易配错的地方）

**规则一：`periph_memory_width` 要跟「数据源」对齐**

```c
// 从 8 位的内存搬到 8 位的串口数据寄存器
init_struct.periph_memory_width = DMA_MEMORY_WIDTH_8BIT; // 根据源地址确定
```

**规则二：地址自增看「是否需要连续访问」**

| 场景 | 源 / 目的 | 自增 |
| --- | --- | --- |
| M2P 发送 | 内存（**要依次取每个字节**） | `memory_inc = ENABLE` |
| M2P 发送 | 串口数据寄存器（**永远是同一个地址**） | `periph_inc = DISABLE` |
| P2M 接收 | 串口数据寄存器（同一个地址） | `periph_inc = DISABLE` |
| P2M 接收 | 内存缓冲区（依次存入） | `memory_inc = ENABLE` |

**口诀：会变的地址才自增。** 外设的寄存器地址永远是一个（写一次就发一个字节），所以外设侧一律 `DISABLE`。

**规则三：`direction` 决定谁是「periph」谁是「memory」**

`periph_addr` / `memory0_addr` 这两个名字只在**外设参与**的传输里名副其实。做 M2M 时没有外设，于是：

```
DMA_MEMORY_TO_MEMORY：把 periph_addr 当作「源」，memory0_addr 当作「目的」

init_struct.periph_addr  = (uint32_t)arr1;   // 源
init_struct.memory0_addr = (uint32_t)arr2;   // 目的
```

> **第一次看到 M2M 的代码都会愣一下**：「我把 arr1 当外设了？」——不是。**结构体是给「有外设」的场景设计的，M2M 只是借用**。记住这一点，代码就好读了。

---

## 三、提交 `0c40272` → `86263f2`：M2M 从轮询到中断

### 3.1 `0c40272`：第一次跑通（轮询等结果）

**提交信息**：`[更新] DMA m2m测试`

这次提交**把整个 PWM 模块的代码全删了**（`main.c` 净减 127 行），换成一段极简的 DMA 测试：

```c
uint8_t arr1[4] = {1, 2, 3, 4};
uint8_t arr2[4] = {0};

void DMA_m2m_config(void)
{
    // 1.开启外设时钟
    rcu_periph_clock_enable(RCU_DMA1); // 只有DMA1支持m2m
    // 2.配置DMA
    dma_single_data_parameter_struct init_struct;
    dma_single_data_para_struct_init(&init_struct);

    init_struct.direction = DMA_MEMORY_TO_MEMORY;
    init_struct.periph_addr = (uint32_t)arr1;
    init_struct.memory0_addr = (uint32_t)arr2;

    init_struct.periph_memory_width = DMA_PERIPH_WIDTH_8BIT;
    init_struct.number = 4U;

    init_struct.periph_inc = DMA_PERIPH_INCREASE_ENABLE;
    init_struct.memory_inc = DMA_MEMORY_INCREASE_ENABLE;
    init_struct.circular_mode = DMA_CIRCULAR_MODE_DISABLE;
    init_struct.priority = DMA_PRIORITY_LOW;

    dma_single_data_mode_init(DMA1, DMA_CH0, &init_struct);

    // 3.启动DMA传输
    dma_channel_enable(DMA1, DMA_CH0);
}
```

然后主循环里用 `delay_1ms(1)` 等它搬完，再打印：

```c
    // DMA搬运
    DMA_m2m_config();
    delay_1ms(1);

    for (uint8_t i = 0; i < sizeof(arr2) / sizeof(arr2[0]); i++)
    {
        printf("arr[%d]=%d\n", (int)i, (int)arr2[i]);
    }
```

**结果**：串口打印 `arr[0]=1 arr[1]=2 arr[2]=3 arr[3]=4`。

**要注意这里的 `delay_1ms(1)` 也是个「坏习惯」**：DMA 搬 4 个字节**几百纳秒就完事了**，但你不能确定它到底用了多久，所以只好「睡 1 ms 再说」。**这是「不知道什么时候完成」的典型症状**——下一次提交就把它治好了。

### 3.2 `86263f2`：用中断通知完成

**提交信息**：`[更新] DMA m2m 使用中断输出结果`

```c
    dma_single_data_mode_init(DMA1, DMA_CH0, &init_struct);

    // 配置中断
    nvic_irq_enable(DMA1_Channel0_IRQn, 0, 0);
    // 清理标志位
    dma_interrupt_flag_clear(DMA1, DMA_CH0, DMA_INT_FLAG_FTF);
    // 开启传输完成中断
    dma_interrupt_enable(DMA1, DMA_CH0, DMA_INT_FTF);

    // 3.启动DMA传输
    dma_channel_enable(DMA1, DMA_CH0);
}

void DMA1_Channel0_IRQHandler(void)
{
    if (dma_interrupt_flag_get(DMA1, DMA_CH0, DMA_INT_FLAG_FTF) == SET)
    {
        // 清标志位
        dma_interrupt_flag_clear(DMA1, DMA_CH0, DMA_INT_FLAG_FTF);

        for (uint8_t i = 0; i < sizeof(arr2) / sizeof(arr2[0]); i++)
        {
            printf("arr[%d]=%d\n", (int)i, (int)arr2[i]);
        }

        // 关闭DMA
        dma_channel_disable(DMA1, DMA_CH0);
    }
}
```

**和上一版的对照**：

| | `0c40272` | `86263f2` |
| --- | --- | --- |
| 怎么知道搬完了 | `delay_1ms(1)` 猜一下 | **FTF 中断通知** |
| 主循环里还有没有等待 | 有 | **没有**（`main` 里只剩空转） |
| 中断函数名 | — | `DMA1_Channel0_IRQHandler`（启动文件写死） |

**中断流程和 EXTI 那套完全一样**（第 06 篇）——**判标志 → 清标志 → 干活**：

```c
if (dma_interrupt_flag_get(DMA1, DMA_CH0, DMA_INT_FLAG_FTF) == SET)
{
    dma_interrupt_flag_clear(DMA1, DMA_CH0, DMA_INT_FLAG_FTF);
    // 干活
}
```

**`DMA_INT_FLAG_FTF`** = Full Transfer Finish，**全部搬完**的完成标志。

> 本次提交把中断优先级设成了 `(0, 0)`（最高），`3085f3a` 又改回 `(2, 2)` 和全工程统一——**起手用最高优先级调试可以，定稿要统一**，不然以后调优先级会被它捣乱。

### 3.3 `3085f3a`：动态配置参数（当时是 main HEAD）

**提交信息**：`[更新] DMA m2m 动态配置DMA参数`

这是 M2M 这条线的收尾，也是**整个 DMA 模块最有价值的一次提交**。它的改变很微妙：**把「源地址」和「长度」从初始化里拿掉，留到运行时再填**。

```c
void DMA_m2m_config(void)
{
    rcu_periph_clock_enable(RCU_DMA1);
    dma_single_data_parameter_struct init_struct;
    dma_single_data_para_struct_init(&init_struct);

    init_struct.direction = DMA_MEMORY_TO_MEMORY;
    // init_struct.periph_addr = ？？;          ← 源地址不填了
    init_struct.memory0_addr = (uint32_t)dat;  // 目的地址固定

    init_struct.periph_memory_width = DMA_PERIPH_WIDTH_8BIT;
    // init_struct.number = ？？;               ← 长度不填了

    init_struct.periph_inc = DMA_PERIPH_INCREASE_ENABLE;
    init_struct.memory_inc = DMA_MEMORY_INCREASE_ENABLE;
    init_struct.circular_mode = DMA_CIRCULAR_MODE_DISABLE;
    init_struct.priority = DMA_PRIORITY_LOW;

    dma_single_data_mode_init(DMA1, DMA_CH0, &init_struct);

    // 配置中断
    nvic_irq_enable(DMA1_Channel0_IRQn, 2, 2);
    dma_interrupt_flag_clear(DMA1, DMA_CH0, DMA_INT_FLAG_FTF);
    dma_interrupt_enable(DMA1, DMA_CH0, DMA_INT_FTF);

    // 3.启动DMA传输
    // dma_channel_enable(DMA1, DMA_CH0); // 没有配置好还不能启动
}
```

**注意最后那行注释**——这句话是这次提交的灵魂：

> **`// 没有配置好还不能启动`**

**为什么要这样做？** 因为数据是从串口来的一包**长度未知**的数据。你在初始化时根本不知道：

- **源地址**：数据在接收缓冲区里，但缓冲区是驱动内部的（`huart->recv_buff`）
- **长度**：串口发来多少个字节，收到才知道

所以参数必须**等数据到了再填**——填的地方就在串口接收回调里：

```c
void on_usart_recv(USART_HandleTypeDef *huart)
{
    huart->recv_buff[huart->recv_length] = '\0';
    if (huart->usartx == USART0)
    {
        printf("usart0_recv:%s\n", huart->recv_buff);
        // 配置剩余参数
        dma_periph_address_config(DMA1, DMA_CH0, (uint32_t)huart->recv_buff);   // 补上源地址
        dma_transfer_number_config(DMA1, DMA_CH0, huart->recv_length);          // 补上长度
        // 启动DMA传输
        dma_channel_enable(DMA1, DMA_CH0);
    }
}
```

**完整的数据流**（这颗芯片在干什么）：

```
① 上电：DMA1_CH0 配好方向/增长/中断，但源地址和长度是空的 → 不启动

② PC 通过串口发来一包数据（比如 "Hello"）
       │
       ▼
   USART0 每收一个字节触发一次 RBNE 中断 → 存进 huart->recv_buff，recv_length++
       │
       ▼ 总线空闲 → IDLE 中断 → on_usart_recv(huart)

③ 回调里：
       printf 打印收到的内容
       dma_periph_address_config(源 = recv_buff)
       dma_transfer_number_config(长度 = recv_length)
       dma_channel_enable()            ← 现在才启动

④ DMA 把 recv_buff 的 N 个字节搬到 dat[] 数组

⑤ 搬完 → FTF 中断 → 打印 dat[]
```

**「动态配置」这个模式的价值**：**DMA 通道成了可复用的「搬运引擎」**——参数的「骨架」（方向、增长、中断）在初始化时定好，参数的「内容」（地址、长度）每次任务前现填。这样**一个通道可以服务无数次不同大小的搬运任务**。

> **这和第 04 篇串口「句柄化」是同一个思想的两个层面**：
> 串口句柄把「参数」从函数里拿出来 → 支持多个串口；
> DMA 动态配置把「地址/长度」从初始化里拿出来 → 支持多次不同任务。
> **共同规律：把「会变的东西」和「不变的东西」分开。**

---

## 四、提交 `57be122`：M2P（内存 → 串口）

**提交信息**：`[更新] DMA m2p 使用DMA将发送的数据从内存搬运到串口的数据寄存器之后自动发送出去`（`dma_usart` 分支）

这次提交在 `msp_uart.c` 里加了发送 DMA 的配置。

```c
// 配置发送DMA 内存=>DMA=>外设USART0
// USART0_TX  DMA1_CH7
void USART_TX_DMA_config(USART_HandleTypeDef *huart)
{
    // 重置DMA
    dma_deinit(huart->usartx_tx_dma, huart->usartx_tx_dma_ch);
    // 1.开启外设时钟
    rcu_periph_clock_enable(huart->usartx_dma_rcu);
    // 2.配置DMA
    dma_single_data_parameter_struct init_struct;
    dma_single_data_para_struct_init(&init_struct);

    init_struct.direction = DMA_MEMORY_TO_PERIPH;
    // init_struct.memory0_addr = ??;                                  ← 动态填
    init_struct.periph_addr = (uint32_t)(&USART_DATA(huart->usartx));  // 串口数据寄存器

    init_struct.periph_memory_width = DMA_MEMORY_WIDTH_8BIT; // 根据源地址确定
    // init_struct.number = ??;                                        ← 动态填

    init_struct.periph_inc = DMA_PERIPH_INCREASE_DISABLE;   // ← 外设地址不自增
    init_struct.memory_inc = DMA_MEMORY_INCREASE_ENABLE;    // ← 内存地址自增
    init_struct.circular_mode = DMA_CIRCULAR_MODE_DISABLE;
    init_struct.priority = DMA_PRIORITY_LOW;

    dma_single_data_mode_init(huart->usartx_tx_dma, huart->usartx_tx_dma_ch, &init_struct);

    // 配置DMA通道的子外设 查表
    dma_channel_subperipheral_select(huart->usartx_tx_dma, huart->usartx_tx_dma_ch, huart->usartx_tx_dma_subperi);
    // 清理DMA搬运完成标志位
    dma_flag_clear(huart->usartx_tx_dma, huart->usartx_tx_dma_ch, DMA_FLAG_FTF);
}
```

### 4.1 和 M2M 对比：三处不同

| 字段 | M2M | M2P |
| --- | --- | --- |
| `direction` | `DMA_MEMORY_TO_MEMORY` | **`DMA_MEMORY_TO_PERIPH`** |
| `periph_addr` | 源内存地址 | **`&USART_DATA(USART0)`** |
| `periph_inc` | **ENABLE**（源内存要依次取字节） | **DISABLE**（外设寄存器地址固定） |
| **子外设选择** | 不需要 | **必须** `dma_channel_subperipheral_select(..., DMA_SUBPERI4)` |

**`dma_channel_subperipheral_select()` 是 M2P/P2M 独有的、最容易漏的一步**。原因：

```
一个 DMA 通道可能被好几个外设共享（请求线接在一起），
所以必须告诉 DMA：「这条通道现在服务的是哪一路请求」

    dma_channel_subperipheral_select(DMA1, DMA_CH7, DMA_SUBPERI4);
                                          ↑ 查表：USART0_TX = DMA1_CH7 / SUBPERI4
```

**漏了它的后果同样是「静默失败」**——DMA 使能了，但不知道为什么没有请求进来。

### 4.2 发送函数改成 DMA 版

```c
// 发送多个byte数据
void send_data(USART_HandleTypeDef *huart, uint8_t *data, uint32_t len)
{
    // while (data && len--)          ← 老的 CPU 搬运版，被注释掉
    // {
    //     send_byte(huart, *data);
    //     data++;
    // }

    // 使用DMA搬运n个字节到数据缓冲区，之后自动发送出去
    dma_memory_address_config(huart->usartx_tx_dma, huart->usartx_tx_dma_ch, DMA_MEMORY_0, (uint32_t)(data));
    dma_transfer_number_config(huart->usartx_tx_dma, huart->usartx_tx_dma_ch, len);
    // 启动DMA传输
    dma_channel_enable(huart->usartx_tx_dma, huart->usartx_tx_dma_ch);
    // 等待完成标志位
    while (dma_flag_get(huart->usartx_tx_dma, huart->usartx_tx_dma_ch, DMA_FLAG_FTF) == RESET)
        ;
    // 完成传输后清理标志
    dma_flag_clear(huart->usartx_tx_dma, huart->usartx_tx_dma_ch, DMA_FLAG_FTF);
}
```

**注意这里 `send_string` 也用 DMA 了**（`strlen(data)` 算长度）：

```c
    dma_transfer_number_config(huart->usartx_tx_dma, huart->usartx_tx_dma_ch, strlen(data));
```

**但这版还是「阻塞」的**——后面那个 `while` 在等 FTF。**为什么已经用 DMA 了还要等？**

因为 `data` 是**调用者栈上/堆上的缓冲区**：

```c
send_data(&husart0, local_buf, 100);   // local_buf 是局部数组
// 如果不等 DMA 搬完就返回，函数结束、栈被复用，DMA 还在读这块内存 → 数据错乱
```

**在缓冲区生命周期不确定的情况下，必须等 DMA 搬完**。如果想真正非阻塞，需要保证缓冲区在整个传输期间有效（通常是静态缓冲区 + 完成中断里再发下一批）。这是 DMA 使用的经典约束。

> 一个**很实际的小坑**：`fputc()` 里调的是 `send_byte()`（CPU 逐字节），**没有走 DMA**。所以 `printf` 依然是阻塞的。注释里那句 `// printf写死在了USART0` 说的就是这件事。

### 4.3 为什么还要 `dma_flag_clear()`

DMA 的 FTF 标志位不会自动清，**不清的话下一次 `while` 等待会立刻通过**（因为标志还是置位的），看起来「DMA 秒完成」，实际根本没搬。**配完一次就清一次**，是个稳妥习惯。

---

## 五、提交 `af0741c`：P2M（串口 → 内存）

**提交信息**：`[更新] DMA p2m 使用DMA将串口数据寄存器接收到的数据搬运给recv_buff，之后在on_usart_recv回调函数中对数据进行处理`

这次提交是**整个模块最巧妙的一步**：**接收不再靠每个字节的中断，而是让 DMA 自己在后台搬**。

```c
// 配置发送DMA 外设USART0=>DMA=>内存 USART接收数据到内存
// USART0_RX  DMA1_CH5
void USART_RX_DMA_config(USART_HandleTypeDef *huart)
{
    // 重置DMA
    dma_deinit(huart->usartx_rx_dma, huart->usartx_rx_dma_ch);
    // 1.开启外设时钟
    rcu_periph_clock_enable(huart->usartx_dma_rcu);
    // 2.配置DMA
    dma_single_data_parameter_struct init_struct;
    dma_single_data_para_struct_init(&init_struct);

    init_struct.direction = DMA_PERIPH_TO_MEMORY;
    init_struct.memory0_addr = (uint32_t)(huart->recv_buff);          // 目的地址
    init_struct.periph_addr = (uint32_t)(&USART_DATA(huart->usartx)); // 源地址

    init_struct.periph_memory_width = DMA_MEMORY_WIDTH_8BIT; // 根据源地址确定
    init_struct.number = USART_RECEIVE_LENGTH;
    ...
    // 3.启动DMA传输
    dma_channel_enable(huart->usartx_rx_dma, huart->usartx_rx_dma_ch);
}
```

### 5.1 中断处理的大改造

**第 04 篇里，每收到一个字节都要进一次 RBNE 中断；现在整段被注释掉了**：

```c
void uart_irq_handle(USART_HandleTypeDef *huart)
{
    // // 处理读取数据缓冲区不为空中断 （每接收一个字节（一帧）就会有一个RBNE中断）
    // if ((usart_interrupt_flag_get(huart->usartx, USART_INT_FLAG_RBNE)) == SET)
    // {
    //     usart_interrupt_flag_clear(huart->usartx, USART_INT_FLAG_RBNE);
    //     uint16_t value = usart_data_receive(huart->usartx);
    //     huart->recv_buff[huart->recv_length] = value;
    //     huart->recv_length++;
    // }

    // 处理检测到空闲中断 （一包数据接收完成产生一个IDLE中断）
    if (usart_interrupt_flag_get(huart->usartx, USART_INT_FLAG_IDLE) == SET)
    {
        // 读取缓冲区,清空缓冲区
        usart_data_receive(huart->usartx);

        // 停止DMA搬运自动完成 FTF
        dma_channel_disable(huart->usartx_rx_dma, huart->usartx_rx_dma_ch);

        // 接收了一包数据
        // 知道DMA搬运了多少个byte数据  获取还有多少数据需要搬运才结束
        uint32_t dma_rev_length = USART_RECEIVE_LENGTH - dma_transfer_number_get(huart->usartx_rx_dma, huart->usartx_rx_dma_ch);
        huart->recv_length = dma_rev_length;

        // 回调函数
        on_usart_recv(huart);

        // 清理完成标志位再开启DMA搬运
        dma_flag_clear(huart->usartx_rx_dma, huart->usartx_rx_dma_ch, DMA_FLAG_FTF);
        dma_channel_enable(huart->usartx_rx_dma, huart->usartx_rx_dma_ch);

        // 清空接收缓冲区
        huart->recv_length = 0;
    }
}
```

### 5.2 「怎么知道收了多少字节」——本节的核心技巧

DMA 搬运是**静默的**：它把字节一个个搬进 `recv_buff`，**不告诉你搬了几个**。

**但你可以用「减法」反推出来**：

```
dma_transfer_number_get() 返回的是「还剩多少个没搬」

初始时： number = USART_RECEIVE_LENGTH = 1024      （准备收 1024 个）
收到 5 个后：还剩 1019

所以：
    已收长度 = 初始长度 - 剩余长度
             = 1024 - 1019
             = 5            ✅
```

```c
uint32_t dma_rev_length = USART_RECEIVE_LENGTH - dma_transfer_number_get(...);
huart->recv_length = dma_rev_length;
```

**这个技巧在所有「DMA + 变长接收」的场景都用得上**，非常值得记住。

### 5.3 一包接收完的完整动作链

```
① DMA 在后台把串口收到的字节搬进 recv_buff（CPU 完全不管）

② 总线空闲 → IDLE 中断触发，进入 uart_irq_handle()
   │
   ├─ usart_data_receive()          → 清 IDLE 标志（先读 STAT0 再读 DATA）
   ├─ dma_channel_disable()         → 先停搬运，防止它继续改 recv_buff
   ├─ 用减法算出收了多少字节
   ├─ on_usart_recv(huart)          → 通知应用层
   ├─ dma_flag_clear(FTF)           → 清掉本次的标志
   ├─ dma_channel_enable()          → 重新武装，等下一包
   └─ recv_length = 0               → 清零，准备下一包
```

**「先关再算再重开」这个顺序是必须的**：

| 顺序 | 为什么 |
| --- | --- |
| **先 `dma_channel_disable()`** | 如果一边算长度、DMA 还在往里搬，长度就不准了 |
| **算完长度再回调** | 回调里要用 `huart->recv_length` |
| **回调之后再重启 DMA** | 保证回调期间缓冲区不会被 DMA 覆盖 |
| **重启前 `dma_flag_clear()`** | 标志不清，DMA 可能认为「上一批已经完成」，行为异常 |

> **一个隐藏的优先级问题**：如果回调里做的事很耗时（比如 `printf` 打印 1000 个字符要 87 ms），这期间 DMA 是**关着的**，串口再来的数据会丢。**DMA 把「搬运」交给硬件，但「处理」还是得靠 CPU 抢时间**。

---

## 六、提交 `90e109f`：给句柄加 DMA，一次支持两个串口

**提交信息**：`[更新] DMA p2m 将dma配置项加入到USART_HandleTypeDef并更新配置方法（USART2 TX PB10 RX PB11；printf写死在USART0）`

这是 DMA 这条线的收尾，**也是「句柄化」价值的高光时刻**。

### 6.1 只加 7 个字段，就支持了第二个串口的 DMA

```c
typedef struct {
    // ...（原来的串口参数、缓冲区、长度）

    uint32_t usartx_dma_rcu;          // DMA 控制器时钟（RCU_DMA0 / RCU_DMA1）

    uint32_t usartx_tx_dma;           // 发送用哪个 DMA 控制器
    uint32_t usartx_tx_dma_ch;        // 发送用哪个通道
    uint32_t usartx_tx_dma_subperi;   // 发送用哪个子外设

    uint32_t usartx_rx_dma;           // 接收用哪个 DMA 控制器
    uint32_t usartx_rx_dma_ch;        // 接收用哪个通道
    uint32_t usartx_rx_dma_subperi;   // 接收用哪个子外设

} USART_HandleTypeDef;
```

**两个串口的 DMA 配置（注意用的是不同的 DMA 控制器）**：

```c
USART_HandleTypeDef husart0 = {
    // ... PA9/PA10、USART0 ...
    .usartx_dma_rcu = RCU_DMA1,
    .usartx_tx_dma = DMA1,
    .usartx_tx_dma_ch = DMA_CH7,
    .usartx_tx_dma_subperi = DMA_SUBPERI4,
    .usartx_rx_dma = DMA1,
    .usartx_rx_dma_ch = DMA_CH5,
    .usartx_rx_dma_subperi = DMA_SUBPERI4,
};

USART_HandleTypeDef husart2 = {
    // ... PB10/PB11、USART2 ...
    .usartx_dma_rcu = RCU_DMA0,       // ← 注意是 DMA0
    .usartx_tx_dma = DMA0,
    .usartx_tx_dma_ch = DMA_CH3,
    .usartx_tx_dma_subperi = DMA_SUBPERI4,
    .usartx_rx_dma = DMA0,
    .usartx_rx_dma_ch = DMA_CH1,
    .usartx_rx_dma_subperi = DMA_SUBPERI4,
};
```

**DMA 配置函数里所有写死的值都变成了句柄成员**：

```diff
-    dma_deinit(DMA1, DMA_CH7);
+    dma_deinit(huart->usartx_tx_dma, huart->usartx_tx_dma_ch);
-    rcu_periph_clock_enable(RCU_DMA1);
+    rcu_periph_clock_enable(huart->usartx_dma_rcu);
-    dma_single_data_mode_init(DMA1, DMA_CH7, &init_struct);
+    dma_single_data_mode_init(huart->usartx_tx_dma, huart->usartx_tx_dma_ch, &init_struct);
-    dma_channel_subperipheral_select(DMA1, DMA_CH7, DMA_SUBPERI4);
+    dma_channel_subperipheral_select(huart->usartx_tx_dma, huart->usartx_tx_dma_ch, huart->usartx_tx_dma_subperi);
```

**同时干掉了一段「丑陋的特殊判断」**：

```diff
-    // 目前只在USART0上配置DMA
-    if (huart->usartx == USART0)
-    {
-        ...
-    }
```

**这个 `if` 的消失，就是句柄化成功的标志**：原来的代码要「特判 USART0」，说明配置还没抽象干净；现在谁配了 DMA 字段谁就用 DMA，**代码里不再有特例**。

### 6.2 USART2 的体现：一个回调管两个串口

`dma_usart` 分支的 `main.c` 里，回调对两个串口一视同仁：

```c
void on_usart_recv(USART_HandleTypeDef *huart)
{
    huart->recv_buff[huart->recv_length] = '\0';
    if (huart->usartx == USART0)
    {
        // printf("usart0_recv:%s\n", huart->recv_buff);
        send_string(huart, (char *)huart->recv_buff);
    }
    if (huart->usartx == USART2)
    {
        send_string(huart, (char *)huart->recv_buff);
    }
}
```

**这就是一个完整的「串口回环（echo）」**：收到什么就发回什么。而 `send_string()` 内部已经改成走 DMA（6.1 节），所以**收发两端都不占用 CPU 搬运**。

> **注意这里的 `printf` 被注释掉了**：因为它走的是 `fputc` → `send_byte`（CPU 逐字节），和 DMA 混用容易打乱输出节奏。

### 6.3 为什么这个分支还没合并

`dma_usart` 分支停在 `90e109f`，**尚未合回 `main`**。可能的原因（从代码状态可以推断）：

| 迹象 | 说明 |
| --- | --- |
| `main.c` 里 `bsp_buzzer_init()` 还在，但 DMA 相关的 `DMA_m2m_config()` 调用没了 | 两条线的 `main.c` 已经分叉 |
| `printf` 被注释、`on_usart_recv` 改成回环 | 还在调试/验证阶段 |
| `main` 上的 `3085f3a` 也在改 `main.c` | 合并时 `main.c` 必然冲突，需要手工处理 |

**这正好是「分支的意义」**：DMA 收发是独立的功能改进，等验证充分了再合。**未合并的分支不代表失败，只代表「还没到合并的时机」。**

---

## 七、DMA 与 CPU 的分工（一张表收尾）

| 环节 | 谁干 | 说明 |
| --- | --- | --- |
| 每个字节的搬运 | **DMA** | 完全不占 CPU |
| 判断一包结束 | CPU（IDLE 中断） | 硬件置位，CPU 响应 |
| 算收到多少字节 | CPU | 减法反推 |
| 处理数据（打印/解析/回发） | CPU | 回调里做 |
| 启动/重启 DMA | CPU | 每次任务前后各一次 |

**结论：DMA 不是「消灭 CPU 参与」，而是「把 CPU 的参与次数从 N 次（N 个字节）降到 3 次（启动、完成中断、重启）」。**

---

## 八、最终代码速查

### 8.1 M2M（`main` 分支当前状态）

```c
uint8_t dat[1024] = {0};

void DMA_m2m_config(void);          // 配置：方向/增长/中断，地址与长度留空
void DMA1_Channel0_IRQHandler(void); // FTF 中断：打印 dat[]，然后关通道

// 使用：串口回调里补上「源地址 + 长度」再启动
dma_periph_address_config(DMA1, DMA_CH0, (uint32_t)huart->recv_buff);
dma_transfer_number_config(DMA1, DMA_CH0, huart->recv_length);
dma_channel_enable(DMA1, DMA_CH0);
```

### 8.2 串口 DMA（`dma_usart` 分支）

```c
// --- msp_uart.c ---
void USART_TX_DMA_config(USART_HandleTypeDef *huart);   // 内存 → 串口
void USART_RX_DMA_config(USART_HandleTypeDef *huart);   // 串口 → 内存

// 发送函数已改为 DMA 版（内部等待 FTF）
void send_data(USART_HandleTypeDef *huart, uint8_t *data, uint32_t len);
void send_string(USART_HandleTypeDef *huart, char *data);

// 接收：DMA 在后台搬，IDLE 中断里算长度 + 回调 + 重启
void uart_irq_handle(USART_HandleTypeDef *huart);
```

### 8.3 三种传输的参数对照（背这一张表就够）

| 字段 | M2M | M2P（发送） | P2M（接收） |
| --- | --- | --- | --- |
| `direction` | `DMA_MEMORY_TO_MEMORY` | `DMA_MEMORY_TO_PERIPH` | `DMA_PERIPH_TO_MEMORY` |
| `periph_addr` | 源内存 | `&USART_DATA(usartx)` | `&USART_DATA(usartx)` |
| `memory0_addr` | 目的内存 | 源内存 | 目的内存（recv_buff） |
| `periph_inc` | `ENABLE` | `DISABLE` | `DISABLE` |
| `memory_inc` | `ENABLE` | `ENABLE` | `ENABLE` |
| `number` | 要搬几个 | 要发几个 | 缓冲区大小（`USART_RECEIVE_LENGTH`） |
| `periph_memory_width` | 8/16/32 BIT | `DMA_MEMORY_WIDTH_8BIT` | `DMA_MEMORY_WIDTH_8BIT` |
| 子外设选择 | 不需要 | **必须**（`DMA_SUBPERI4`） | **必须**（`DMA_SUBPERI4`） |
| 控制器 | **仅 DMA1** | DMA0/DMA1 | DMA0/DMA1 |

### 8.4 通道映射速查

| 外设 | 控制器 | 通道 | 子外设 |
| --- | --- | --- | --- |
| USART0_TX | DMA1 | CH7 | `DMA_SUBPERI4` |
| USART0_RX | DMA1 | CH5 | `DMA_SUBPERI4` |
| USART2_TX | DMA0 | CH3 | `DMA_SUBPERI4` |
| USART2_RX | DMA0 | CH1 | `DMA_SUBPERI4` |

---

## 九、排查清单

| 现象 | 优先检查 |
| --- | --- |
| `dma_channel_enable()` 了但什么都没发生 | **通道号选错**（外设请求线是焊死的，必须查表）；**M2M 用了 DMA0** |
| M2P/P2M 不工作，但通道号看着没错 | **漏了 `dma_channel_subperipheral_select()`** |
| 传输数量不对 / 只搬了一部分 | `number` 单位搞错（是「次数」不是「字节数」）；或 `width` 与 `number` 不匹配 |
| 收到的数据是乱序 / 错位 | `*_inc` 配反了：外设侧应 `DISABLE`，内存侧应 `ENABLE` |
| 数据只搬了第一个字节 | 内存侧 `memory_inc` 忘了 `ENABLE`，一直读同一个地址 |
| 中断只进一次 | 中断里没清 `DMA_INT_FLAG_FTF` |
| `while (dma_flag_get(...))` 一秒就通过，但数据没搬 | **配完没清 FTF 标志**，导致误判「已完成」 |
| 收到的长度总是错的 | 算长度时 DMA 还在跑；应**先 `dma_channel_disable()` 再算** |
| 第二包数据收不到 | IDLE 里重启 DMA 前没 `dma_flag_clear()`，或重启时机在回调之后 |
| 串口 DMA 发送偶尔丢数据 | 发送缓冲区是局部的，DMA 还没搬完函数就返回了——要么等 FTF，要么用静态缓冲区 |
| 回调里处理太慢导致丢包 | 回调里 `printf` 是阻塞的，期间 DMA 关着收不到数据 |
| `printf` 和 DMA 混用后输出乱 | `printf` 走 `fputc` → `send_byte`（CPU 搬运），和 DMA 不是一条路，会互相插队 |
| P2M 缓冲区越界 | 一包超过 `USART_RECEIVE_LENGTH`（1024）时 DMA 会把 `recv_buff` 写穿 |
| 改了两个串口都只有 USART0 能用 | 代码里还有 `if (huart->usartx == USART0)` 之类的特判没清掉 |

## 十、自测题

1. 不用 DMA 时，`send_data()` 发 1024 字节，CPU 具体在做哪些事？DMA 版本把哪些事接走了？
2. GD32F4 有几个 DMA 控制器？为什么 M2M 只能用在 DMA1？
3. M2M 的代码里，为什么 `arr1` 被写进了 `periph_addr`？这是不是有点怪？
4. `periph_inc` 和 `memory_inc` 什么时候该 `ENABLE`、什么时候该 `DISABLE`？请为 M2P 和 P2M 分别说明。
5. `dma_channel_subperipheral_select()` 是干什么的？漏了它会有什么现象？
6. 「静态配置」和「动态配置」的区别是什么？`3085f3a` 为什么必须动态配置？那句 `// 没有配置好还不能启动` 在说什么？
7. P2M 接收里，`USART_RECEIVE_LENGTH - dma_transfer_number_get(...)` 算的是什么？为什么这么算能得到「已收字节数」？
8. IDLE 中断里为什么要「先关 DMA → 算长度 → 回调 → 清标志 → 重启 DMA」？把顺序换一下会怎样？
9. `57be122` 里已经用了 DMA，为什么 `send_data()` 后面还要 `while (dma_flag_get(...) == RESET);`？什么时候才可以去掉这个等待？
10. `90e109f` 里删掉的 `if (huart->usartx == USART0)` 说明了什么？为什么说这个 `if` 的消失是句柄化成功的标志？
11. `fputc()` 走的是 DMA 还是 CPU？为什么 `printf` 和 DMA 混用容易出现输出错乱？

## 十一、练习题

1. 给 M2M 加一个「循环搬运」的测试：用 `dma_transfer_number_get()` 观察传输过程中剩余数量的变化。
2. 把串口发送的 `while (dma_flag_get(...) == RESET);` 改成「发送完成中断 + 静态缓冲区」，做到真正不阻塞。
3. 给 P2M 加缓冲区溢出保护：如果一包超过 `USART_RECEIVE_LENGTH`，在回调里报错并丢弃。
4. 用 DMA 把 `dat[1024]` 里的数据**循环**搬到串口（`circular_mode = DMA_CIRCULAR_MODE_ENABLE`），观察「不用重新启动就能连续发送」的效果。
5. 把 `main` 分支的 M2M 测试和 `dma_usart` 分支的串口 DMA 合并到一个版本里（提示：注意 `main.c` 的冲突，需要保留两边的初始化）。

---

## 附：提交清单

| # | 提交 | 日期 | 分支 | 说明 | 关键内容 |
| --- | --- | --- | --- | --- | --- |
| 1 | `0c40272` | 09-22 11:37 | main | [更新] DMA m2m 测试 | 新建 `DMA_m2m_config()`：DMA1_CH0、M2M、`arr1`→`arr2`、8 bit、4 个；主循环 `delay_1ms(1)` 后打印结果；**把整个 PWM 模块代码删掉**（-127 行） |
| 2 | `86263f2` | 09-22 14:47 | main | [更新] DMA m2m 使用中断输出结果 | 加 `nvic_irq_enable(DMA1_Channel0_IRQn, 0, 0)` + `dma_interrupt_enable(...DMA_INT_FTF)`；新增 `DMA1_Channel0_IRQHandler()` 打印 `arr2` 并关通道；删掉主循环里的等待 |
| 3 | `3085f3a` | 09-22 15:14 | main | [更新] DMA m2m 动态配置 DMA 参数 | `periph_addr` / `number` 改为运行时填（`// ？？`）；`dma_channel_enable` 注释为「没有配置好还不能启动」；**回调里补参数并启动**；中断优先级由 0,0 改为 2,2 |
| 4 | `57be122` | 09-22 18:02 | dma_usart | [更新] DMA m2p 内存 → 串口数据寄存器 | `USART_TX_DMA_config()`：DMA1_CH7、M2P、`&USART_DATA(USART0)`、`periph_inc` 关、`SUBPERI4`；`send_data` / `send_string` 改为 DMA 搬运 + 等 FTF |
| 5 | `af0741c` | 09-22 19:48 | dma_usart | [更新] DMA p2m 串口数据寄存器 → 内存 | `USART_RX_DMA_config()`：DMA1_CH5、P2M、目标 `recv_buff`；**注释掉 RBNE 处理**；IDLE 里关 DMA → 减法算长度 → 回调 → 清标志 → 重启 |
| 6 | `90e109f` | 09-23 11:22 | dma_usart | [更新] DMA p2m 把 DMA 配置并入句柄 | `USART_HandleTypeDef` 新增 **7 个 DMA 字段**；`husart0`=DMA1/CH7/CH5，`husart2`=**DMA0**/CH3/CH1；配置函数全部改用 `huart->`；**删掉 `if (huart->usartx == USART0)` 特判** |

**这条线的两级台阶**

| 台阶 | 提交 | 学到的东西 |
| --- | --- | --- |
| M2M | `0c40272` `86263f2` `3085f3a` | 参数结构体、完成中断、**动态配置** |
| 串口 DMA | `57be122` `af0741c` `90e109f` | M2P / P2M 差异、子外设选择、**剩余长度反推**、**句柄扩展** |

**分支状态提醒**（截至 2026-09-26）

```
main       ──●──●──●──●──●──●──●──●  (bbce6b7 ← 当前 HEAD，含 RTC 与看门狗，见第 11、12 篇)
                      \
                       dma_usart ──●──●──●──●  (acb207a ← 串口收发 DMA + .gitignore，仍未合并)
```

> `dma_usart` 分支在 `90e109f` 之后又加了一次 `acb207a [更新] .gitignore`（见第 01 篇 7.1 节），
> **DMA 相关代码没有变化**，所以本篇的分析依然对应 `90e109f` 的状态。

## 参考笔记

- `../../../NOTE/Note/DMA.md` —— DMA 直接存储器存取
  - 2.1 / 2.2 节：「两个控制器 + 通道映射参考」= 本篇 1.3 / 1.4 节
  - 2.3 节「三种传输方式」表格与本篇 1.5 节一致
  - 3.3 节 M2M 开发流程、3.6 节「源长度不定的动态配置」= 本篇第三章（**教材与本工程思路完全一致**）
  - 4.5 节「发送功能封装」与本篇第四章、5.3 节「接收中断处理」与本篇第五章是同一件事
  - 教材版用 `dsdps` 作为参数变量名，本工程用 `init_struct`，实质相同

> 本笔记仅作学习整理，内容来自本仓库真实提交记录。
