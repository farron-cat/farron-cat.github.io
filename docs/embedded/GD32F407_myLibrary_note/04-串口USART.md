# 04 · 串口 USART 通信 · 学习笔记

> 这一篇讲 **6 次提交 + 1 次分支合并**：从 `main.c` 里裸写初始化，到抽成 `Hardware/msp_uart.c`，再到「回调解耦」，最后重构成「句柄 + 参数结构体」支持多串口。
> 整理日期：2026-09-23　｜　提交范围：`31f8243`、`d41b189`、`ebc8568`、`8e13d14`、`56609c3`、`6a37639`、`d251346`(合并)

## 怎么读这份笔记

| 你的情况 | 建议路线 |
| --- | --- |
| 只想能打印调试信息 | 第三章（硬件）+ 5.1 节（`fputc` 重定向）→ 直接抄 |
| 串口收不到数据 | 八章「排查清单」 |
| 想理解「为什么要句柄化」 | **第六章**——同一份代码的三个版本对照，这是全项目设计水平最高的一次重构 |
| 想搞懂 IDLE 中断 | 5.4 节，这是串口接收里最容易懵的点 |

## 知识点地图

```
USART 串口通信
├── 硬件                USART0: PA9(TX)/PA10(RX)   USART2: PB10(TX)/PB11(RX)
├── 参数                115200-8-N-1，LSB first
├── 四步初始化          时钟 → GPIO 复用 → 参数 → 收发 + 中断 → 使能
├── GPIO 复用           GPIO_MODE_AF + gpio_af_set(..., GPIO_AF_7, ...)
├── 发送                send_byte / send_data / send_string，靠 TBE 标志位等发送完成
├── printf 重定向       fputc() 指向 USART0，需要 MicroLIB
├── 接收（双中断）       RBNE（每来一字节）+ IDLE（一包收完）
├── 一帧 vs 一包        字节边界 vs 数据包边界
├── 回调解耦            on_usart_recv(huart) —— 驱动层不认识应用层
└── 句柄化              USART_HandleTypeDef：把「参数 + 缓冲区 + 长度」打成一个包
```

## 学习目标

- 会独立配好一个串口（引脚、复用、波特率）并让它能收发
- 说清楚「一帧」和「一包」的区别，知道 RBNE 和 IDLE 两个中断各自负责什么
- 掌握 `fputc()` 重定向的原理与前提条件
- 理解「全局变量 → 参数传递 → 句柄结构体」三种封装形态的演进理由
- 能用回调把一个「驱动」和「业务」解耦开

---

## 一、串口为什么重要

在嵌入式开发里，**串口就是你的眼睛**：

| 用途 | 说明 |
| --- | --- |
| 打印调试信息 | `printf()` 输出变量值、执行到哪一步，比打断点方便（尤其是实时性相关的 bug） |
| 与 PC 通信 | 上位机下发指令、上传数据 |
| 与另一块单片机通信 | 本工程的 USART2 就是**连着另一块 STC 单片机**（PB10→P3.1 / PB11→P3.0） |

**代价是它很慢**：115200 bps ≈ 每秒 11520 字节，比 CPU 慢好几个数量级。所以「串口输出」这种做法只适合调试，不适合高频数据流——这也是第 08 篇要用 DMA 来接管串口收发的原因。

---

## 二、串口最基础的三个概念

| 概念 | 一句话 | 本工程的值 |
| --- | --- | --- |
| **波特率** | 每秒传多少个「码元」 | 115200 |
| **数据位数** | 一帧里数据几位 | 8 |
| **校验位 / 停止位** | 纠错方式 / 帧结束标志 | 无校验（`NONE`）/ 1 位停止位 |

> 完整帧 = **1 起始位 + 8 数据位 + 0 校验位 + 1 停止位 = 10 位**。所以 115200 bps ÷ 10 ≈ **11520 字节/秒**——这就是前面那个换算的由来。

「**一帧**」= 一个字节在线上传输时的样子；「**一包**」= 你需要当作一个完整消息处理的一组字节。**这两个词的区分是理解串口接收中断的关键**，5.3 节会展开。

---

## 三、硬件接线

| 串口 | TX | RX | 复用 | 用途 |
| --- | --- | --- | --- | --- |
| USART0 | PA9 | PA10 | `GPIO_AF_7` | 连 PC / 下载器，**`printf` 走这里** |
| USART2 | PB10 | PB11 | `GPIO_AF_7` | 连 STC 单片机（TX→P3.1，RX←P3.0） |

**接线守则**（背下来，能省掉一半的调试时间）：

```
A 的 TX  →  B 的 RX
A 的 RX  ←  B 的 TX
GND      ─   GND          ← 必须共地，否则电平没有共同参考
```

**USART / UART / 串口 的区别**：UART 没有时钟线（异步），USART 多一个时钟线、可以同步。GD32 的外设叫 USART，本工程当 UART 用（没用同步模式）。

---

## 四、提交演进（6 次提交，三段式）

### 4.1 阶段一：在 `main.c` 里裸写（`31f8243`、`d41b189`）

**提交信息**：`[更新] 测试串口` / `[更新] 测试串口接收`

两次提交只改了 `User/main.c`，直接在 `main()` 上面写了一个 `USART_config()`，然后：

```c
int main(void)
{
    systick_config();
    USART_config();

    while (1)
    {
        printf("hello\r\n");
        delay_1ms(500);
    }
}
```

接收测试（`d41b189`）也是裸写，中断处理函数直接放在 `main.c`：

```c
if (usart_interrupt_flag_get(USART0, USART_INT_FLAG_RBNE) == SET)
{
    usart_interrupt_flag_clear(USART0, USART_INT_FLAG_RBNE);
    uint16_t value = usart_data_receive(USART0);
    g_recv_buff[g_recv_length] = value;
    g_recv_length++;
}
if (usart_interrupt_flag_get(USART0, USART_INT_FLAG_IDLE) == SET)
{
    // 读取缓冲区,清空缓冲区
    usart_data_receive(USART0);
    g_recv_buff[g_recv_length] = '\0';

    // TODO: g_recv_buff为接收的数据，g_recv_length为接收的长度
    printf("rec:%s", g_recv_buff);

    g_recv_length = 0;
}
```

**注意那个 `TODO` 注释**——作者当时已经把「回调」的想法写在代码里了，下一次提交就兑现了。**这类注释很值钱**，它是代码演进的路线图。

### 4.2 阶段二：抽成 `Hardware/msp_uart.c`（`ebc8568`）

**提交信息**：`[更新] 串口接收与发送 封装`

这次提交新建了 `Hardware/msp_uart/`，把 `main.c` 里的 129 行删掉，换成 200 行驱动代码。**但封装方式还很初级**：所有配置都在函数体里写死，数据靠全局变量传递。

```c
#define USART_RECEIVE_LENGTH 1024
// 串口接收缓冲区大小
uint8_t g_recv_buff[USART_RECEIVE_LENGTH]; // 接收缓冲区
// 接收到字符存放的位置
int g_recv_length = 0;

static void GPIO_config()
{
    uint32_t usartx_tx_rcu = RCU_GPIOA;      // ← 全是函数内的局部变量，
    uint32_t usartx_tx_port = GPIOA;         //    也就是说「这些值无法从外面改」
    uint32_t usartx_tx_pin = GPIO_PIN_9;
    uint32_t usartx_tx_af = GPIO_AF_7;
    ...
}
```

**这个版本的三个问题**：

| 问题 | 后果 |
| --- | --- |
| 配置参数写在函数体里（局部变量） | 想改成 USART2 只能再复制一份函数 |
| 数据靠全局变量 `g_recv_buff` / `g_recv_length` | 全局变量人人可改，多串口必然打架 |
| 中断服务函数写死 `USART0` | 一个函数只能服务一个串口 |

**版本次优但有效**——它已经解决了「`main.c` 被 200 行初始化代码污染」的问题，这已经比阶段一好很多。

### 4.3 阶段三之一：加回调 + 第二个串口（`8e13d14`）

**提交信息**：`[更新] 增加接收数据回调函数，usart0 重定向了printf，增加了usart2 tx:B10 (连接stc P3.1) rx:B11 (连接stc P3.0)`

三次改动：

**① `printf` 重定向到 USART0**

```c
// 重写fputc方法  调用printf,会自动调用这个方法实现打印
int fputc(int ch, FILE *f)
{
    send_byte(USART0, (uint8_t)ch);
    return ch;
}
```

**② 新增 USART2，但用的是「复制粘贴」法**——`g_usart0_recv_buff` / `g_usart2_recv_buff` 各来一份，初始化函数复制一份改成 `USART2_config()`。

**③ 加回调**（当时是每个串口一个回调）：

```c
extern void on_usart0_recv(uint8_t *data, uint32_t len);
extern void on_usart2_recv(uint8_t *data, uint32_t len);
```

**回调的参数是 `(数据指针, 长度)`**——这是一种常见设计，但和后面要讲的句柄版相比，缺点也明显：**每加一个串口就要加一个回调函数名**。

> 顺带一提，`56609c3 [修改] 解决警告` 这次提交做的事很小但很典型：
> ```diff
> -    send_string(USART2, data);
> +    send_string(USART2, (char *)data);
> ```
> `uint8_t *` 传进 `char *` 参数会有类型警告，加个强制转换消除。**这类警告不建议无视**——类型不一致往往真的藏着 bug。

### 4.4 阶段三之二：句柄化重构（`6a37639`）

**提交信息**：`[优化] 重新封装msp_uart`（`msp_uart.c` 净减 199 行，`msp_uart.h` 加 43 行）

这是整个项目**设计水平最高的一次重构**。核心动作：**把所有配置项从局部变量提升成结构体成员**。

```c
typedef struct {

    uint32_t usartx_tx_rcu;      // TX 引脚所在端口的时钟位
    uint32_t usartx_tx_port;     // TX 端口
    uint32_t usartx_tx_pin;      // TX 引脚
    uint32_t usartx_tx_af;       // TX 复用编号

    uint32_t usartx_rx_rcu;      // RX 引脚所在端口的时钟位
    uint32_t usartx_rx_port;
    uint32_t usartx_rx_pin;
    uint32_t usartx_rx_af;

    uint32_t usartx;             // 哪个 USART（USART0 / USART2）
    uint32_t usartx_rcu;         // USART 时钟
    uint32_t usartx_irqn;        // 中断号（USART0_IRQn / USART2_IRQn）

    uint32_t usartx_p_baudrate;  // 以下 5 项是串口参数（p = parameter）
    uint32_t usartx_p_parity;
    uint32_t usartx_p_wl;
    uint32_t usartx_p_stop_bit;
    uint32_t usartx_p_data_first;

    uint8_t recv_buff[USART_RECEIVE_LENGTH];  // 每个串口自己的接收缓冲区
    uint16_t recv_length;                     // 每个串口自己的接收长度

} USART_HandleTypeDef;
```

**这个结构体为什么能解决前面所有问题？** 因为它把「一个串口需要的全部信息」打包成了一个变量。于是：

```c
USART_HandleTypeDef husart0 = {
    .usartx_tx_rcu = RCU_GPIOA,
    .usartx_tx_port = GPIOA,
    .usartx_tx_pin = GPIO_PIN_9,
    .usartx_tx_af = GPIO_AF_7,

    .usartx_rx_rcu = RCU_GPIOA,
    .usartx_rx_port = GPIOA,
    .usartx_rx_pin = GPIO_PIN_10,
    .usartx_rx_af = GPIO_AF_7,

    .usartx = USART0,
    .usartx_rcu = RCU_USART0,
    .usartx_irqn = USART0_IRQn,

    .usartx_p_baudrate = 115200,
    .usartx_p_parity = USART_PM_NONE,
    .usartx_p_wl = USART_WL_8BIT,
    .usartx_p_stop_bit = USART_STB_1BIT,
    .usartx_p_data_first = USART_MSBF_LSB,
};
```

**用的是「指定初始化器」（designated initializer）**——`.成员名 = 值` 的写法。好处：

| 好处 | 说明 |
| --- | --- |
| 一眼看出每个值在配什么 | 不用去数第 7 个参数是什么 |
| 顺序随便写 | 不会因为结构体定义改了顺序就配错 |
| 没写的成员自动为 0 | 不用全部填 |

**驱动函数从此全部收 `huart` 指针**：

```c
void send_byte(USART_HandleTypeDef *huart, uint8_t data);
void send_data(USART_HandleTypeDef *huart, uint8_t *data, uint32_t len);
void send_string(USART_HandleTypeDef *huart, char *data);
```

**回调也从「每个串口一个」变成「一个就够」**：

```c
// 旧：extern void on_usart0_recv(uint8_t *data, uint32_t len);
//     extern void on_usart2_recv(uint8_t *data, uint32_t len);
// 新：
extern void on_usart_recv(USART_HandleTypeDef *huart);   // 一个回调，句柄里带着「是谁」
```

应用层想知道「是哪个串口发来的」，从句柄里读就行：

```c
if (huart->usartx == USART0) { ... }
```

**三种形态对照总结**：

| | 阶段一：main.c 裸写 | 阶段二：全局变量 | 阶段三：句柄 |
| --- | --- | --- | --- |
| 配置放哪 | main.c 里 | 函数体内局部变量 | 结构体成员（外部可改） |
| 数据放哪 | 全局变量 | 全局变量 | 句柄成员 |
| 支持几个串口 | 1 | 写几份代码就几个 | **想加几个加几个，只加一个结构体变量** |
| 加 USART1 要改几处 | 复制整个函数 | 复制整个函数 + 加全局变量 | **只加一个 `husart1`** |
| 回调 | 无 | 每串口一个 | 共用一个 |

> **这就是「句柄（Handle）」的本质**：一个结构体变量代表一个实例，所有函数只认这个指针。STM32 HAL 库的 `UART_HandleTypeDef` 就是这个思路——**本工程用标准外设库亲手复刻了一遍 HAL 的核心设计**。

### 4.5 分支合并（`d251346`）

`d251346 [合并] 合并usart分支到main`。合并前 `usart` 分支上有两次提交（`d41b189` 测试接收、`ebc8568` 封装），同时 `main` 上也在推进充电流水灯（第 05 篇）。

> **合并的时机很讲究**：`ebc8568` 那次提交把 `main.c` 里 129 行删掉了，如果直接在主线上边做流水灯边改串口，`main.c` 会改得很难合。**「功能在分支上做完，验证通过再合回主线」**是本仓库一直遵守的习惯——后面 EXTI、DMA、数码管、矩阵键盘都一样。

---

## 五、最终代码逐段解读

### 5.1 初始化：三层调用

```c
static void GPIO_USART_config(USART_HandleTypeDef *huart)
{
    GPIO_config(huart);
    USART_config(huart);
}

void msp_uart_init()
{
    GPIO_USART_config(&husart0);
    GPIO_USART_config(&husart2);
}
```

**`msp_uart_init()` 就是给应用层看的唯一入口**：一句话初始化两个串口。

### 5.2 GPIO 配置：复用模式独有的三步

```c
static void GPIO_config(USART_HandleTypeDef *huart)
{
    // tx
    rcu_periph_clock_enable(huart->usartx_tx_rcu);                              // ① 开端口时钟
    gpio_mode_set(huart->usartx_tx_port, GPIO_MODE_AF, GPIO_PUPD_NONE, ...);    // ② 复用模式
    gpio_af_set(huart->usartx_tx_port, huart->usartx_tx_af, ...);               // ③ 选复用功能
    gpio_output_options_set(huart->usartx_tx_port, GPIO_OTYPE_PP, GPIO_OSPEED_50MHZ, ...); // ④ 输出速度

    // rx
    rcu_periph_clock_enable(huart->usartx_rx_rcu);
    gpio_mode_set(huart->usartx_rx_port, GPIO_MODE_AF, GPIO_PUPD_NONE, ...);
    gpio_af_set(huart->usartx_rx_port, huart->usartx_rx_af, ...);
    // gpio_output_options_set(...);   ← RX 不需要，被注释掉了
}
```

| 点 | 说明 |
| --- | --- |
| **必须 `GPIO_MODE_AF`** | 引脚由 USART 外设控制，不是普通 GPIO。**忘了这步是最常见的「串口没反应」原因** |
| `gpio_af_set` 的 `GPIO_AF_7` | 查表得出：USART0/USART2 都在这几个引脚上复用 AF7 |
| **RX 不配 `output_options`** | 输出参数（推挽/开漏、速度）对输入引脚无意义。注释掉是正确做法 |
| TX 用 `GPIO_OSPEED_50MHZ` | 输出速度要够快才能跟上 115200 的边沿。对比 LED 只用 2 MHz |

### 5.3 USART 配置：五步走

```c
static void USART_config(USART_HandleTypeDef *huart)
{
    // 1.打开USART外设时钟
    rcu_periph_clock_enable(huart->usartx_rcu);

    // 2.USART属性配置
    usart_deinit(huart->usartx);                                        // 复位（清掉上电残留配置）
    usart_baudrate_set(huart->usartx, huart->usartx_p_baudrate);        // 波特率 115200
    usart_parity_config(huart->usartx, huart->usartx_p_parity);         // 校验位 无
    usart_word_length_set(huart->usartx, huart->usartx_p_wl);           // 数据位数 8
    usart_stop_bit_set(huart->usartx, huart->usartx_p_stop_bit);        // 停止位 1
    usart_data_first_config(huart->usartx, huart->usartx_p_data_first); // LSB 先行

    // 3.发送和接收配置
    usart_transmit_config(huart->usartx, USART_TRANSMIT_ENABLE);
    usart_receive_config(huart->usartx, USART_RECEIVE_ENABLE);

    // 4.打开中断
    nvic_irq_enable(huart->usartx_irqn, 2, 2);                          // NVIC 注册，抢占2/响应2
    usart_interrupt_enable(huart->usartx, USART_INT_RBNE);              // 缓冲区非空 = 收到一个字节
    usart_interrupt_enable(huart->usartx, USART_INT_IDLE);              // 总线空闲 = 一包收完

    // 5.USART使能
    usart_enable(huart->usartx);
}
```

**「收发都要显式使能」是新手最常踩的坑**：`usart_transmit_config(USART_TRANSMIT_ENABLE)` 和 `usart_receive_config(USART_RECEIVE_ENABLE)` 不写，引脚配得再对也一个字都收不到/发不出。

**`nvic_irq_enable(huart->usartx_irqn, 2, 2)`**：前一个 2 是抢占优先级，后一个是响应（子）优先级。全工程统一用 2/2，具体含义见第 06 篇。

### 5.4 接收：两个中断配合（本节最重要）

```c
void uart_irq_handle(USART_HandleTypeDef *huart)
{
    // 处理读取数据缓冲区不为空中断 （每接收一个字节（一帧）就会有一个RBNE中断）
    if ((usart_interrupt_flag_get(huart->usartx, USART_INT_FLAG_RBNE)) == SET)
    {
        usart_interrupt_flag_clear(huart->usartx, USART_INT_FLAG_RBNE);   // ① 必须先清标志

        uint16_t value = usart_data_receive(huart->usartx);               // ② 读走数据
        huart->recv_buff[huart->recv_length] = value;                     // ③ 存进缓冲区
        huart->recv_length++;
    }

    // 处理检测到空闲中断 （一包数据接收完成产生一个IDLE中断）
    if (usart_interrupt_flag_get(huart->usartx, USART_INT_FLAG_IDLE) == SET)
    {
        // 软件先读USART_STAT0,再读USART_DATA可清除该位
        usart_data_receive(huart->usartx);

        on_usart_recv(huart);          // ④ 回调：告诉应用层「收完一包了」

        huart->recv_length = 0;        // ⑤ 清空长度，准备下一包
    }
}
```

**为什么需要两个中断？** 因为它们解决的是两个不同粒度的问题：

| 中断 | 触发时机 | 粒度 | 干什么 |
| --- | --- | --- | --- |
| **RBNE**（Receive Buffer Not Empty） | **每收到一个字节**都触发 | 一帧 | 把字节塞进缓冲区、长度 +1 |
| **IDLE**（总线空闲） | 收到数据后**总线静默一个字符时间**触发 | **一包** | 回调通知应用层「这一包齐了」 |

```
线上数据流：   H  e  l  l  o  [空闲]        W  o  r  l  d  [空闲]
               └─RBNE×5─┘  └IDLE┘         └──RBNE×5──┘  └IDLE┘
               收 5 次中断  收 1 次中断     收 5 次中断    收 1 次中断
                            ↑ 触发回调                     ↑ 触发回调
```

**为什么不用「固定长度」或「超时」来判断一包结束？** 因为 IDLE 是**硬件判断的**：「这一段时间一个字节都没来，说明对面发完了」。这比软件计时**精确且不占 CPU**——这是串口接收最经典的用法。

**两个容易出错的细节**：

| 细节 | 为什么 |
| --- | --- |
| RBNE 必须**手动清标志** | 不清会在退出中断的瞬间又进来一次，死循环 |
| IDLE 清标志靠**读 STAT0 再读 DATA** | 这是硬件规定。代码里 `usart_data_receive()` 那行就是干这个的，**看起来像多余的代码，删了就重复触发** |
| 缓冲区溢出没有保护 | `recv_length` 一直加，超过 `USART_RECEIVE_LENGTH` 就越界。**这是当前实现的真实缺陷**，可以自己加个上限判断 |

### 5.5 发送：等 TBE 标志位

```c
// 发送一byte数据
void send_byte(USART_HandleTypeDef *huart, uint8_t data)
{
    usart_data_transmit(huart->usartx, data);                            // 写进数据寄存器
    while (RESET == usart_flag_get(huart->usartx, USART_FLAG_TBE))       // 等缓冲区腾空
        ;
}
```

**为什么发完要等？** 因为串口很慢。`usart_data_transmit()` 只是把字节写进发送寄存器就返回了，**数据还在以 115200 的速度一位一位往外挪**。如果不等就写第二个字节，会把上一个覆盖掉。

`TBE`（Transmit Buffer Empty）置位表示「发送寄存器空了，可以放下一个了」。

```c
// 发送多个byte数据
void send_data(USART_HandleTypeDef *huart, uint8_t *data, uint32_t len)
{
    while (data && len--)          // data 非空 且 len 还没减到 0
    {
        send_byte(huart, *data);
        data++;
    }
}

// 发送字符串
void send_string(USART_HandleTypeDef *huart, char *data)
{
    while (data && *data)          // data 非空 且 还没到字符串结尾
    {
        send_byte(huart, (uint8_t)(*data));
        data++;
    }
}
```

| 函数 | 结束条件 | 用途 |
| --- | --- | --- |
| `send_data` | 发满 `len` 个字节 | 发二进制数据（可能含 `\0`） |
| `send_string` | 遇到 `\0` | 发字符串 |

**注意**：`send_byte` 内部有 `while` 阻塞等待，所以这三个函数**都是阻塞的**——发 100 字节大约阻塞 8.7 ms（100×10/115200）。高频发送时这就成了瓶颈，第 08 篇的 DMA 发送就是为了解决它。

### 5.6 `printf` 重定向的原理

```c
// 重写fputc方法  调用printf,会自动调用这个方法实现打印
int fputc(int ch, FILE *f)
{
    send_byte(&husart0, (uint8_t)ch);
    return ch;
}
```

**原理**：C 标准库里的 `printf()` 最终是通过调用 `fputc()` 把每个字符写出去的。所以**只要重写 `fputc()`，`printf()` 的输出目标就被换掉了**——从「屏幕」换成了「USART0」。

**两个前提条件**（缺一个就编译不过或没输出）：

| 条件 | 说明 |
| --- | --- |
| 勾选 **Use MicroLIB** | Keil 里的选项。标准 C 库的 `printf` 带了完整缓冲/格式化，重定向方式不同且体积大；MicroLIB 是精简版，专为嵌入了设计 |
| `#include <stdio.h>` | 声明 `FILE` 类型和 `printf` |

**注意 `fputc` 写死了 `&husart0`**——也就是说 `printf` 永远走 USART0。这不是缺陷，是刻意的：调试口固定一个，其他串口走 `send_string(&husart2, ...)`。

---

## 六、最终代码速查

```c
// --- Hardware/msp_uart.h ---
void msp_uart_init();                                              // 初始化 USART0 + USART2
void send_byte(USART_HandleTypeDef *huart, uint8_t data);
void send_data(USART_HandleTypeDef *huart, uint8_t *data, uint32_t len);
void send_string(USART_HandleTypeDef *huart, char *data);
extern void on_usart_recv(USART_HandleTypeDef *huart);              // 弱回调，应用层重写

// 全局句柄：想加串口就再加一个
USART_HandleTypeDef husart0;   // PA9/PA10
USART_HandleTypeDef husart2;   // PB10/PB11
```

**参数速查表**：

| 项目 | USART0 | USART2 |
| --- | --- | --- |
| TX / RX | PA9 / PA10 | PB10 / PB11 |
| 复用 | `GPIO_AF_7` | `GPIO_AF_7` |
| 波特率 | 115200 | 115200 |
| 校验/数据/停止 | N / 8 / 1 | N / 8 / 1 |
| 中断 | `USART0_IRQn`，优先级 2/2 | `USART2_IRQn`，优先级 2/2 |
| 中断服务函数名 | `USART0_IRQHandler` | `USART2_IRQHandler` |
| 缓冲区大小 | `USART_RECEIVE_LENGTH` = 1024 | 同左 |

**应用层怎么写**（`main.c` 里的真实例子）：

```c
void on_usart_recv(USART_HandleTypeDef *huart)
{
    huart->recv_buff[huart->recv_length] = '\0';      // 补字符串结束符

    if (huart->usartx == USART0)
    {
        printf("usart0_recv:%s\n", huart->recv_buff);
        // 后面接的是 DMA 回传（第 08 篇）
    }
}
```

---

## 七、中断处理函数的「就近放置」

本工程的串口中断没有放在 `gd32f4xx_it.c`，而是写在 `msp_uart.c` 末尾：

```c
// USART0中断处理函数必须叫这个
// 在startup.s中配置了中断向量表 line124
// 中断中不能写耗时的任务
void USART0_IRQHandler(void)
{
    USART_HandleTypeDef *p = &husart0;
    uart_irq_handle(p);
}

void USART2_IRQHandler(void)
{
    USART_HandleTypeDef *p = &husart2;
    uart_irq_handle(p);
}
```

**这个「转一手」的写法很精妙**：

```
USART0_IRQHandler()  ← 名字被启动文件写死，必须这么叫，但它只是个壳
      ↓ 把「是谁的中断」变成参数
uart_irq_handle(&husart0)  ← 真正的逻辑，两个串口共用一份
```

两个中断函数各自只有两行，真正的处理逻辑（`uart_irq_handle`）**只写了一遍**。这就是 4.4 节句柄化重构带来的红利。

> 另外注意注释里那句「**中断中不能写耗时的任务**」——这也解释了为什么 `on_usart_recv()` 回调里只做简单打印，而 DMA 搬运（第 08 篇）的调用链要小心处理。

---

## 八、排查清单

| 现象 | 优先检查 |
| --- | --- |
| `printf` 完全没输出 | Keil 里没勾 **Use MicroLIB**；`fputc` 没重定向；TX/RX 接反 |
| 收到的是乱码 | **两边波特率不一致**；或时钟配置不对导致实际波特率偏低（检查 `SystemCoreClock`） |
| 一个字节都收不到 | 忘了 `usart_receive_config(USART_RECEIVE_ENABLE)`；忘了 `usart_enable()` |
| 完全没反应 | GPIO 没配成 `GPIO_MODE_AF`；`gpio_af_set` 的 AF 编号错（本工程是 AF7） |
| 只收到第一个字节 | RBNE 中断里没清标志；或缓冲区越界把数据冲掉了 |
| 中断进了但一直出不来 | IDLE 标志清除方式不对——必须**先读 STAT0 再读 DATA** |
| 收到一包后重复触发回调 | IDLE 那行 `usart_data_receive()` 被当成冗余代码删掉了 |
| 只能收一次，之后没反应 | `recv_length` 没清零（应清成 0） |
| 发长数据时丢字节 | 没等 `USART_FLAG_TBE`；或发送期间被高优先级中断长时间占用 |
| 每次收发都卡顿 | `send_byte` 是阻塞等待，数据量大了就慢——考虑第 08 篇的 DMA |
| 加了 USART1 要复制一堆代码 | 说明还在用旧版封装——应该加一个 `husart1` 结构体变量 |

## 九、自测题

1. 「一帧」和「一包」分别指什么？本工程用哪个中断处理一帧、哪个处理一包？
2. RBNE 中断里为什么必须手动清标志？不清会发生什么？
3. IDLE 标志为什么要「先读 STAT0 再读 DATA」才能清？如果代码里删掉那行 `usart_data_receive()` 会怎样？
4. `usart_data_transmit()` 返回后数据就发出去了吗？为什么后面要等 `TBE`？
5. `printf` 重定向为什么只要重写 `fputc` 就行？为什么必须用 MicroLIB？
6. 句柄化重构（`6a37639`）之前，想加第三个串口要改几个地方？之后呢？
7. 回调从 `on_usart0_recv(data, len)` + `on_usart2_recv(data, len)` 改成 `on_usart_recv(huart)`，好处是什么？应用层怎么区分是哪个串口？
8. 当前实现里有一个真实缺陷：接收缓冲区没有溢出保护。请说出它会在什么情况下崩，以及怎么修。
9. 为什么 USART 的 TX 要配 `GPIO_OSPEED_50MHZ`，而 LED 只需要 `GPIO_OSPEED_2MHZ`？

## 十、练习题

1. 给 `uart_irq_handle()` 加上缓冲区溢出保护：`recv_length` 到上限时停止写入并置一个溢出标志。
2. 实现一个「命令解析」：PC 发 `LED1 ON` 就点亮 LED1，`LED1 OFF` 就熄灭。在 `on_usart_recv()` 里做。
3. 用 `husart2` 往 STC 单片机发一串数据，验证双向通信（注意 STC 那边的串口参数要一致）。
4. 把 `send_string` 改成「不等 TBE」的版本（只写数据寄存器），看看长数据会不会丢——理解为什么会丢。

---

## 附：提交清单

| 提交 | 日期 | 说明 | 关键改动 |
| --- | --- | --- | --- |
| `31f8243` | 2026-09-16 17:06 | [更新] 测试串口 | 只在 `main.c`：新增本地 `USART_config()`，用 `printf` 输出测试（+135/-67） |
| `d41b189` | 2026-09-17 18:22 | [更新] 测试串口接收（`usart` 分支） | `main.c` 里加 RBNE + IDLE 接收测试，留 TODO 注释（+85/-126） |
| `ebc8568` | 2026-09-18 16:12 | [更新] 串口接收与发送 封装（`usart` 分支） | **新建 `Hardware/msp_uart/`**：`GPIO_config` / `USART_config` / `send_byte` / `send_data` / `send_string` / `fputc`；全局变量 `g_recv_buff`；`main.c` 掉 129 行 |
| `d251346` | 2026-09-18 16:22 | [合并] 合并 usart 分支到 main | 无冲突合并 |
| `8e13d14` | 2026-09-18 18:01 | [更新] 增加接收回调，USART0 重定向 printf，新增 USART2（TX:B10 → STC P3.1，RX:B11 ← STC P3.0） | 新增 `on_usart0_recv` / `on_usart2_recv` 弱回调；新增 `USART2_config()` 与 `g_usart2_recv_buff`；`bsp_battery_flows.c` 顺带加 2 行 |
| `56609c3` | 2026-09-20 11:20 | [修改] 解决警告 | `send_string(USART2, (char *)data)` 加类型转换（1 行） |
| `6a37639` | 2026-09-20 19:05 | [优化] **重新封装 msp_uart** | 引入 `USART_HandleTypeDef` 句柄 + `husart0`/`husart2` 指定初始化；所有函数改收指针；回调合并为 `on_usart_recv(huart)`；`msp_uart.c` 净减 199 行 |

**这次模块演进的三级台阶**

| 台阶 | 提交 | 解决的核心问题 |
| --- | --- | --- |
| 1. 能用 | `31f8243` `d41b189` | 在 main.c 里跑通收发 |
| 2. 好放 | `ebc8568` `8e13d14` | 代码搬出 main.c，用回调解耦 |
| 3. 好扩 | `6a37639` | 句柄化，支持任意多个串口且零复制成本 |

**后续延伸**：`dma_usart` 分支上的 `57be122` / `af0741c` / `90e109f` 三次提交，把「收发」都交给了 DMA——**句柄结构体里新增了 7 个 DMA 字段**，见第 08 篇。

## 参考笔记

- `../../../NOTE/Note/UART.md` —— UART / USART 串口通信（串行/并行、帧格式、校验方式、引脚复用表、IDLE 中断原理）
  - 参考笔记里的「串口引脚与复用功能查询表」就是本篇 `GPIO_AF_7` 的来源；第五章「串口输入」与本篇 5.4 节是同一件事的两种讲法

> 本笔记仅作学习整理，内容来自本仓库真实提交记录。
