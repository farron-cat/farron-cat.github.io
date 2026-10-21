# 15 · IIC / I2C 总线（软件实现 + 硬件实现）· 学习笔记

> 这一篇讲 **6 次提交**：`7711e72`（软件 I2C 跑通）→ `ae57848`（补读写接口）→ `d3a0319`（硬件 I2C）→ `c2dc4c2`（软硬合并）→ `5ce9c77`（整理 + 服务 SPI OLED）→ `886ba18`（加按列写入，服务 OLED）。
> 这是本工程的**第一条"协议级"总线**，也是后面 PCF8563（第 17 篇）、IIC OLED（第 18 篇）和 SC12B 触摸按键（第 31 篇）的基础。
> 整理日期：2026-10-06　｜　提交范围：`7711e72`、`ae57848`、`d3a0319`、`c2dc4c2`、`5ce9c77`、`886ba18`

## 怎么读这份笔记

| 你的情况 | 建议路线 |
| --- | --- |
| 只想知道怎么用 | 第七章速查表 + `msp_iic_write_nbyte()` 的签名 |
| 设备没响应（printf 打 `device not found`） | 第九章排查清单前 6 条 |
| 想搞懂 I2C 时序 | 第四章（四步时序）——**这是本篇的核心** |
| 想学"同一功能做两版实现"的封装套路 | 第五章（软件）→ 第六章（硬件）→ 第七章（怎么合并成一个接口） |
| 准备面试 | I2C 为什么必须开漏、起始/停止条件、ACK 机制、7 位地址与读写位 |

## 知识点地图

```
IIC / I2C 总线
├── 硬件             PB6 = SCL、PB7 = SDA（同一组 GPIO）；必须开漏 + 上拉
├── 为什么开漏       多设备"线与"；推挽会短路
├── 电气基础         上拉电阻 + 总线电容 → 上升沿是 RC 曲线（速度受限的根源）
├── 四条时序规则     空闲都高 / 起始=SCL高时SDA下降 / 停止=SCL高时SDA上升 / 数据在SCL低时变化
├── 一次完整通信     起始 → 设备地址+W → 寄存器地址 → (重复起始 → 地址+R) → 数据 → ACK/NACK → 停止
├── 软件实现         用 GPIO 手动翻转 + SDA 输入/输出模式切换
├── 硬件实现         I2C0 外设 + AF4 + 400 kHz，靠标志位（SBSEND/ADDSEND/TBE/BTC/RBNE）推进
├── 软硬合并         一个 `IIC_HARD_SOFT_SWITCH` 宏切换；外部接口统一，内部 static 实现各写一份
├── 错误码           IIC_STA 枚举：区分"地址没响应""寄存器没响应""数据没响应""总线忙"
└── 应用接口         write_nbyte / read_nbyte / write_col_nbyte（按列刷 OLED 用）
```

## 学习目标

- 说清 I2C 为什么必须开漏输出，以及"线与"的具体含义
- 背下四条时序规则，能手画出起始、停止、单字节、应答的波形
- 掌握软件 I2C 的完整实现（含 SDA 双向切换这个关键技巧）
- 掌握硬件 I2C 的标志位推进流程，知道每一步在等什么
- 理解"同一功能两套实现 + 编译期开关"这种工程封装方式的优点
- 会看错误码定位"卡在哪一步"

---

## 一、I2C 是什么：两根线挂一串设备

```
        VCC ─┬──────┬──────┬──────┐
             │      │      │      │
        ┌────┴────┐ │      │      │
        │ 上拉电阻 │ │      │      │   （板上 4.7k 或其他阻值）
        └────┬────┘ │      │      │
   MCU ──────┼──────┼──────┼──────┼────── SCL（时钟，PB6）
             │      │      │      │
   MCU ──────┼──────┼──────┼──────┼────── SDA（数据，PB7）
             │      │      │      │
        ┌────┴──┐ ┌─┴───┐ ┌┴────┐ ┌┴─────┐
        │ OLED  │ │PCF  │ │ 其他 │ │ 更多 │  ← 每个设备有自己的 7 位地址
        └───────┘ └─────┘ └─────┘ └──────┘
```

| 特性 | 说明 |
| --- | --- |
| 线数 | **2 根**（SCL 时钟 + SDA 数据），再加 GND |
| 拓扑 | 总线式，**多设备并联**，靠**地址**区分 |
| 速率 | 标准 100 kHz / 快速 400 kHz（本工程硬件 I2C 配 400 kHz） |
| 主从 | 主设备发起通信，从设备响应（本工程单片机是主机） |
| **电气** | **必须开漏 + 上拉**——这是 I2C 最本质的一条 |

**本工程用的引脚**：`PB6 = SCL`、`PB7 = SDA`（都在 GPIOB，所以时钟只开一次）。

> **⚠️ 一个实际提醒**：本项目 `Doc/硬件信息汇总.md` 里记载了板上的 I2C 总线在 **PB6/PB7**，与代码一致；但同一个文档也指出了 **PB10 被代码当作 USART2_TX、硬件上却是 LCD 背光**（见第 20 篇）。**用外设前先核对硬件文档，能省掉大量"代码没错却不工作"的时间。**

---

## 二、电气基础：为什么必须开漏 + 上拉

**先说结论**：

```
I2C 的引脚配置 = 开漏输出（GPIO_OTYPE_OD）+ 外部上拉电阻

写 0  →  输出级把线拉到 GND        （强下拉，谁都能拉低）
写 1  →  输出级关断，线被上拉拉高   （高阻，别人可以把它拉低）
读    →  直接读引脚电平
```

**为什么不能用推挽？（两个原因，第 10 篇矩阵键盘也讲过）**

**① 会短路**：

```
设备 A 推挽输出高（强）+ 设备 B 推挽输出低（强）
        两者直接连在一起 → 一个强上拉撞一个强下拉 → 大电流，可能烧引脚
开漏写 1 是"高阻"，不会和别人打架 → 这就是"线与"的前提
```

**② 读不回来**：

```
推挽输出高电平时，引脚被强制拉高，外部想拉低也拉不下去
→ 读回来永远是 1 → 无法判断从设备有没有应答
```

**线与（wired-AND）的含义**：

```
只要有一个设备拉低 → 总线就是低
所有设备都释放    → 总线才被上拉拉高
⇒ "线与" = 任何一方都能"否决"
```

**上拉电阻决定了速率上限**：

```
上升时间 t_r ≈ R × C（上拉电阻 × 总线电容）

电阻太大 → 上升太慢 → 高速率下还没升到门限就被采样 → 通信失败
电阻太小 → 上升快，但低电平时灌电流大 → 功耗高、驱动能力考验
⇒ 所以 I2C 的速率和"上拉电阻 + 线长/挂载数量"是绑在一起的一组参数
```

> **和第 10 篇矩阵键盘的呼应**：那里用"开漏 + 内部上拉"模拟 8051 准双向口，解决的是**同一个问题**——需要一根线既能输出又能被外部拉低。**I2C 是这套电气方案的又一个应用场景。**

---

## 三、四条时序规则（背下来）

| # | 规则 | 记忆点 |
| --- | --- | --- |
| 1 | **空闲时**：SCL 和 SDA **都是高** | 上拉把它们拉高 |
| 2 | **起始信号**：SCL 为高时，**SDA 由高变低** | "高电平里拉低数据" |
| 3 | **停止信号**：SCL 为高时，**SDA 由低变高** | "高电平里放开数据" |
| 4 | **数据有效性**：**SCL 为低时才允许改变 SDA**；SCL 为高时 SDA 必须稳定 | "低电平改数据，高电平读数据" |

**规则 4 是理解整个协议的关键**：

```
       ┌───┐   ┌───┐   ┌───┐
SCL ───┘   └───┘   └───┘   └───
        ↑       ↑
     低电平期间改 SDA      高电平期间 SDA 必须稳定 → 接收方在这里采样
```

**为什么起始/停止要用"SCL 高时 SDA 变化"这种特殊组合？** 因为正常数据阶段 SCL 高时 SDA 是稳定的，**所以"SCL 高时 SDA 还能变化"这件事本身不会在数据阶段出现**——用它来表示"帧的开始/结束"不会产生歧义。这是很经典的设计思路：**用非法状态表示特殊事件**。

---

## 四、一次完整通信的流程

**读 PCF8563 的时间寄存器（本工程最典型的一次操作）**：

```
① 起始 S
② 设备地址 + 写位：0x51 << 1 | 0 = 0xA2        ← 因为要先写"要读哪个寄存器"
③ 从机应答 ACK
④ 寄存器地址：0x02                              ← 从秒寄存器开始读
⑤ 从机应答 ACK
⑥ 重复起始 Sr（Repeated Start，不先停止）
⑦ 设备地址 + 读位：0x51 << 1 | 1 = 0xA3
⑧ 从机应答 ACK
⑨ 读数据 × N；每读一个字节主机回 ACK
⑩ 读完最后一个字节，主机回 **NACK**               ← 告诉从机"我够了"
⑪ 停止 P
```

**三个容易忽略的点**：

| 点 | 说明 |
| --- | --- |
| **为什么要"重复起始"而不是"停止再起始"** | 停止会让总线空闲，其他主设备可能抢占总线，导致这次读操作被打断。重复起始能**保持总线占有权** |
| **为什么最后一个字节回 NACK** | ACK/NACK 是**接收方**给发送方的："我收到了/我不要了"。最后一个字节回 NACK，从设备就知道该停止了 |
| **7 位地址为什么要左移 1 位** | 地址帧是"7 位地址 + 1 位读写方向"，凑成一个字节。所以 `addr << 1 \| rw` |

**从机地址速查（本工程用到的）**：

| 设备 | 7 位地址 | 写（<<1\|0） | 读（<<1\|1） |
| --- | --- | --- | --- |
| **PCF8563**（RTC） | `0x51` | `0xA2` | `0xA3` |
| **SSD1306**（IIC OLED） | `0x78` | `0xF0` | `0xF1` |
| **SC12B**（触摸按键，第 31 篇） | `0x40` | `0x80` | `0x81` |

> **这条总线上现在挂了 4 类从机**（`Doc/硬件信息汇总.md` §4.6）：
> `U5` IIC-OLED（0x78）、`U8` PCF8563（0x51）、**`U2` SC12B 触摸按键（0x40）**、以及 LCD 的触摸屏（`U10`/`J1`）。
> **"两线挂一串"的好处在这里体现得淋漓尽致**——4 个器件只花 2 根线 + 各自一个地址。
> **代价也跟着来了**：**任何一次被打断的 I2C 事务，受害的都是"这一串里的某一个"**
> （第 17 篇的闹钟、第 31 篇的触摸按键都栽在这上面）。

---

## 五、提交 `7711e72` + `ae57848`：软件 I2C

### 5.1 首版：用 GPIO 手动翻出时序

```c
#define SCL_H   gpio_bit_set(GPIOB, GPIO_PIN_6)
#define SCL_L   gpio_bit_reset(GPIOB, GPIO_PIN_6)

#define SDA_H   gpio_bit_set(GPIOB, GPIO_PIN_7)
#define SDA_L   gpio_bit_reset(GPIOB, GPIO_PIN_7)

#define SDA_IN  gpio_mode_set(GPIOB, GPIO_MODE_INPUT,  GPIO_PUPD_NONE, GPIO_PIN_7)
#define SDA_OUT gpio_mode_set(GPIOB, GPIO_MODE_OUTPUT, GPIO_PUPD_NONE, GPIO_PIN_7)
#define SDA_STA gpio_input_bit_get(GPIOB, GPIO_PIN_7)

// 100kbit/s 100000 <=> 1000000us
//  1 <=> 10us
//  SCL高低分别持续5us
#define IIC_DELAY delay_1us(2)
```

**SDA 的双向问题**：SDA 既要"主机输出数据"，又要"主机读从机应答"——所以代码里**每次方向切换都要重新配 GPIO 模式**：

```c
IIC_SDA_OUT;   // 要说话了 → 配成输出
IIC_SDA_IN;    // 要听话了 → 配成输入
```

**这是软件 I2C 与软件 SPI 最大的区别**：SPI 有独立的 MOSI/MISO 两根线（不用切方向），I2C 只有一根 SDA（必须切方向）。

> ⚠️ **一处和注释对不上的地方**：注释写的是"**SCL 高低分别持续 5 μs**"（对应约 100 kHz），但代码写的是 `delay_1us(2)`（半周期 2 μs）。**算下来约 250 kHz**，比注释里说的快。
> 小贴士：`delay_1us()` 是**每次循坏调用**，函数调用本身也有开销，所以实际周期会比 2 μs 略长。**这类"注释与代码不一致"是本工程的常见现象（第 07 篇的软 PWM 也是），自己写的时候一定要注意注释要跟着代码改。**
> 另外 I2C 对"最慢"没有限制——**延时宁长勿短**，慢一点只是速度慢，快过头会直接通信失败。

### 5.2 四条时序的实现

**起始信号**：

```c
static void msp_iic_start(void)
{
    // SCL高电平时，SDA下降沿

    IIC_SDA_OUT;
    // SDA高电平持续
    IIC_SDA_H;
    IIC_DELAY;
    // SCL高电平持续
    IIC_SCL_H;
    IIC_DELAY;
    // SDA低电平持续
    IIC_SDA_L;      // ← 关键：此刻 SCL 已是高
    IIC_DELAY;
    // SCL低电平持续
    IIC_SCL_L;
    IIC_DELAY;
}
```

**停止信号**：

```c
static void msp_iic_stop(void)
{
    // SCL高电平时，SDA上升沿

    IIC_SDA_OUT;
    IIC_SDA_L;
    IIC_DELAY;
    IIC_SCL_H;
    IIC_DELAY;
    IIC_SDA_H;      // ← 关键：此刻 SCL 已是高
    IIC_DELAY;
}
```

**对比一下就很清楚**：

| | 起始 | 停止 |
| --- | --- | --- |
| SCL 高时 SDA 的变化方向 | **下降**（高→低） | **上升**（低→高） |
| SDA 初值 | 先拉高 | 先拉低 |
| 结束状态 | SCL 拉低（进入数据阶段） | 保持双高（回到空闲） |

**发送一个字节（高位先发）**：

```c
static void msp_iic_send_byte(uint8_t byte)
{
    IIC_SDA_OUT;
    IIC_SCL_L;          // 先确保 SCL 低（低电平允许改数据）
    IIC_DELAY;

    for (uint8_t i = 0; i < 8; i++)
    {
        // ① SCL 低：摆好这一位
        if ((byte >> (7 - i)) & 0x01)
            IIC_SDA_H;
        else
            IIC_SDA_L;

        // ② SCL 拉高：从机在这一刻采样
        IIC_SCL_H;
        IIC_DELAY;

        // ③ SCL 拉低：准备下一位
        IIC_SCL_L;
        IIC_DELAY;
    }
}
```

**「低电平改数据、高电平被采样」被写成了三段式循环**——和四条时序规则完全对应。

**等待应答**（这段最精妙）：

```c
static uint8_t msp_iic_wait_ack(void)
{
    // SCL确定会在低电平，可以改变SDA电平
    // 主机主动拉低SDA，交出控制权

    IIC_SDA_OUT;
    IIC_SDA_H;      // ① 先拉高：保证"后面被拉低"这个动作是有效信息
    IIC_DELAY;

    IIC_SDA_IN;     // ② 交出控制权（高阻，从机可以拉低它）
    IIC_DELAY;

    IIC_SCL_H;      // ③ 给时钟，从机此刻发出应答
    IIC_DELAY;

    if (IIC_SDA_STA)  // ④ 读 SDA
        return 1;     // 还是高 → 没人应答 → 失败

    IIC_SCL_L;        // ⑤ 成功时拉低 SCL，进入下一字节
    IIC_DELAY;
    return 0;
}
```

**四步走：拉高 → 放权 → 给时钟 → 采样**。

**为什么要先主动拉高？** 因为上拉电阻把线拉高需要时间（RC 曲线），**如果上一刻线还是低，你直接放权，读到的可能还是"没升上去的低电平"**，就会把"没人应答"误判成"有人应答"（正好和第 10 篇矩阵键盘"稳定延时"是同一类问题）。

> ⚠️ **一个真实的返回值 bug**：这个函数注释写着"**0 收到从机应答、1 未收到**"，函数体也确实是"读到高电平返回 1"。**但失败分支里没有把 SCL 拉低就 `return 1` 了**——SCL 会停在高电平。下一次通信从 `msp_iic_start()` 开始（那里会重新拉高 SCL），所以**碰巧能工作**，但严格说这是"靠巧合正确"。

**接收一个字节**：

```c
static uint8_t msp_iic_recv_byte(void)
{
    uint8_t byte = 0;

    IIC_SDA_IN;      // 主动放权，准备接收
    IIC_SCL_L;
    IIC_DELAY;

    for (uint8_t i = 0; i < 8; i++)
    {
        // 等待从机写入SDA
        IIC_SCL_H;                    // 从机在 SCL 高之前已经把数据摆好
        if (IIC_SDA_STA)
            byte |= (0x01 << (7 - i)); // 高位先进
        else
            byte &= ~(0x01 << (7 - i));
        IIC_DELAY;
        IIC_SCL_L;
        IIC_DELAY;
    }
    return byte;
}
```

**发送应答 / 非应答**：

```c
static void msp_iic_send_ack(void)   { IIC_SDA_OUT; IIC_SDA_L; IIC_DELAY; IIC_SCL_H; IIC_DELAY; IIC_SCL_L; IIC_DELAY; }
static void msp_iic_send_nack(void)  { IIC_SDA_OUT; IIC_SDA_H; IIC_DELAY; IIC_SCL_H; IIC_DELAY; IIC_SCL_L; IIC_DELAY; }
```

**两个函数只差 SDA 拉低还是拉高**——**ACK = 拉低，NACK = 放开**。这就是"总线空闲时是高、任何设备拉低即有效"的直接体现。

### 5.3 对外接口：三个函数

```c
uint8_t msp_iic_write_nbyte(uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len);
uint8_t msp_iic_write_col_nbyte(uint8_t addr, uint8_t reg, uint8_t *data, uint16_t offset, uint16_t len);
uint8_t msp_iic_read_nbyte(uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len);
```

| 函数 | 用途 | 典型调用者 |
| --- | --- | --- |
| `write_nbyte` | 写寄存器（连续写） | PCF8563 写时间 |
| `read_nbyte` | 读寄存器（连续读） | PCF8563 读时间 |
| **`write_col_nbyte`** | **按 `offset` 跨步取数据再写** | **IIC OLED 刷屏**（见下） |

**`write_col_nbyte()` 是 `886ba18` 为 OLED 加的特殊函数**——因为 OLED 的显存是"按页"组织的（一页 8 行、128 列），**刷屏时数据不是连续取的，而是每隔 128 个字节取一个**：

```c
for (uint16_t i = 0; i < len; i++)
{
    msp_iic_send_byte(data[i * offset]);   // ← 跨步取，不是 data[i]
    ...
}
```

**这就是"驱动层为具体器件让步"的典型例子**：通用接口解决 90% 的场景，剩下 10%（OLED 刷屏）需要一个带 `offset` 的变体。

**写完一次通信的收尾**：

```c
static uint8_t msp_iic_soft_write_nbyte(uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len)
{
    msp_iic_start();
    msp_iic_send_byte(addr << 1 | 0x0);          // 设备地址 + 写
    if (msp_iic_wait_ack()) { printf("IIC device not found!\n"); return IIC_SEND_ADDR_FAILED; }

    msp_iic_send_byte(reg);                      // 寄存器地址
    if (msp_iic_wait_ack()) { printf("IIC device not acknowledged!\n"); return IIC_SEND_REG_FAILED; }

    for (uint16_t i = 0; i < len; i++)           // 连续写数据
    {
        msp_iic_send_byte(data[i]);
        if (msp_iic_wait_ack()) { printf("IIC device not acknowledged"); return IIC_SEND_DAT_FAILED; }
    }

    msp_iic_stop();
    return IIC_SUC;
}
```

**注意这里的错误处理很细**：每个 ACK 都检查，并返回**不同的错误码**（地址失败 / 寄存器失败 / 数据失败）。这比"统一返回 0/1"有用得多——**看错误码就知道卡在哪一步**。

### 5.4 提交 `ae57848`：为 PCF8563 补读写接口

首版只有 `write_nbyte`，第二次提交补上了：

```c
uint8_t msp_iic_read_nbyte(uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len);
```

**读操作的实现比写复杂**（多了一次重复起始 + ACK 管理）：

```c
static uint8_t msp_iic_soft_read_nbyte(uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len)
{
    msp_iic_start();
    msp_iic_send_byte(addr << 1 | 0x0);   // ① 先以"写"身份，为了送寄存器地址
    if (msp_iic_wait_ack()) { printf("read1: IIC device not found!\n"); return IIC_SEND_ADDR_FAILED; }

    msp_iic_send_byte(reg);
    if (msp_iic_wait_ack()) { printf("read2: IIC device not found!\n"); return IIC_SEND_REG_FAILED; }

    msp_iic_start();                       // ② 重复起始
    msp_iic_send_byte(addr << 1 | 0x1);   // ③ 再以"读"身份
    if (msp_iic_wait_ack()) { printf("read3: IIC device not found!\n"); return IIC_SEND_ADDR_FAILED; }

    for (uint16_t i = 0; i < len - 1; i++) // ④ 前面 N-1 个字节回 ACK
    {
        data[i] = msp_iic_recv_byte();
        msp_iic_send_ack();
    }
    data[len - 1] = msp_iic_recv_byte();   // ⑤ 最后一个字节回 NACK
    msp_iic_send_nack();
    msp_iic_stop();
    return IIC_SUC;
}
```

**三段 `printf` 分别标了 `read1/read2/read3`**——**这是很实用的调试手法**：出错时一眼看出是"设备地址没响应"还是"寄存器地址没响应"还是"读地址没响应"。

> **一个真实的边界 bug**：如果 `len == 0`，`for (i = 0; i < len - 1; ...)` 里 `len - 1` 是 `uint16_t` 的 `0 - 1 = 65535`，会**循环 65535 次**把缓冲区写穿。本工程调用时 len 都 ≥ 1，所以没暴露。**自己写的时候记得在函数开头加 `if (len == 0) return IIC_SUC;`**。

---

## 六、提交 `d3a0319`：硬件 I2C

**用外设而不是手动翻引脚**，换来的是：不占 CPU 逐位翻转、速率精确、时序由硬件保证。

### 6.1 初始化

```c
static void msp_iic_hard_gpio_config(void)
{
    // IIC0_SCL PB6 AF4
    rcu_periph_clock_enable(SCL_RCU);
    gpio_mode_set(SCL_PORT, GPIO_MODE_AF, GPIO_PUPD_NONE, SCL_PIN);
    gpio_output_options_set(SCL_PORT, GPIO_OTYPE_OD, GPIO_OSPEED_MAX, SCL_PIN);   // ← 必须开漏
    gpio_af_set(SCL_PORT, IIC_SCL_AF, SCL_PIN);                                   // ← AF4

    // IIC0_SDA PB7 AF4
    ... 同上
}

static void msp_iic_hard_iic_config(void)
{
    i2c_deinit(i2cx);
    rcu_periph_clock_enable(i2cx_rcu);
    i2c_clock_config(i2cx, i2cx_speed, I2C_DTCY_2);   // 400 kHz，占空比 2:1
    i2c_enable(i2cx);
    i2c_ack_config(i2cx, I2C_ACK_ENABLE);             // 使能应答
}
```

| 点 | 说明 |
| --- | --- |
| **AF 编号是 `GPIO_AF_4`** | 查表：I2C0 复用在 PB6/PB7（也是 PB8/PB9 等） |
| **即使硬件 I2C 也要 `GPIO_OTYPE_OD`** | 因为 I2C 的电气要求是硬件无法改变的——**开漏是电气层的事，不是"软件实现才需要"** |
| `I2C_DTCY_2` | SCL 高低占空比 2:1（低电平时间是高电平的两倍）——I2C 规范允许，便于兼容慢速从机 |
| `i2c_ack_config(ENABLE)` | 主机接收时自动回 ACK 的总开关 |

### 6.2 超时等待封装（本节的精华）

```c
#define TIMEOUT 50000
static uint8_t I2C_wait(uint32_t flag)     // 等标志"置位"
{
    uint16_t cnt = 0;
    while (!i2c_flag_get(i2cx, flag))
    {
        cnt++;
        if (cnt > TIMEOUT)
            return 1;                      // 超时
    }
    return 0;
}

static uint8_t I2C_waitn(uint32_t flag)    // 等标志"清零"
{
    uint16_t cnt = 0;
    while (i2c_flag_get(i2cx, flag))
    {
        cnt++;
        if (cnt > TIMEOUT)
            return 1;
    }
    return 0;
}
```

**这一对函数解决了硬件 I2C 最大的痛点**：硬件外设是靠标志位推进的，**如果从设备没接、线断了、器件坏了，标志位永远不来 → 程序死等 → 卡死**。

```
裸写 while(!flag);        → 器件没接 = 死机
封装成 I2C_wait(flag)     → 器件没接 = 返回错误码，程序继续跑 ✅
```

**这是"裸机程序健壮性"的一个标准套路**：**所有等待外部响应的循环，都应该带超时。**

### 6.3 写流程：靠五个标志位推进

```c
static uint8_t msp_iic_hard_write_nbyte(uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len)
{
    /************* start ***********************/
    if (I2C_waitn(I2C_FLAG_I2CBSY)) return IIC_BUS_BSY;   // ① 等总线空闲（BUSY 清零）
    i2c_start_on_bus(i2cx);
    if (I2C_wait(I2C_FLAG_SBSEND))  return IIC_START_FAILED;  // ② 等起始发送完成

    /************* device address **************/
    i2c_master_addressing(i2cx, addr << 1, I2C_TRANSMITTER);  // ← 注意也要左移！
    if (I2C_wait(I2C_FLAG_ADDSEND)) return IIC_SEND_ADDR_FAILED;  // ③ 等地址被应答
    i2c_flag_clear(i2cx, I2C_FLAG_ADDSEND);                   // ← ADDSEND 必须手动清

    /************ register address ************/
    if (I2C_wait(I2C_FLAG_TBE))     return IIC_SEND_REG_FAILED;   // ④ 等发送缓冲空
    i2c_data_transmit(i2cx, reg);
    if (I2C_wait(I2C_FLAG_BTC))     return IIC_SEND_REG_FAILED;   // ⑤ 等字节传输完成

    /***************** data ******************/
    for (i = 0; i < len; i++) { ...同上... }

    /***************** stop ********************/
    i2c_stop_on_bus(i2cx);
    while (I2C_CTL0(I2C0) & I2C_CTL0_STOP);   // 等 STOP 位自动清除
    i2c_ack_config(i2cx, I2C_ACK_ENABLE);
    return IIC_SUC;
}
```

**五个标志位的作用**（硬件 I2C 的核心就是要记住这几个）：

| 标志 | 含义 | 类比软件实现 |
| --- | --- | --- |
| `I2C_FLAG_I2CBSY` | 总线忙 | "别人正在用线" |
| `I2C_FLAG_SBSEND` | 起始已发出 | `msp_iic_start()` 执行完 |
| `I2C_FLAG_ADDSEND` | 地址被应答 | `msp_iic_wait_ack()` 成功 |
| `I2C_FLAG_TBE` | 发送缓冲空 | "可以放下一个字节了" |
| `I2C_FLAG_BTC` | 一字节传输完 | "这一位发完了" |
| `I2C_FLAG_RBNE` | 接收缓冲非空 | "收到一个字节了" |

> **⚠️ 注意 `while (I2C_CTL0(I2C0) & I2C_CTL0_STOP);` 这里写死了 `I2C0`**（前面都用 `i2cx` 变量）。**改用到 I2C1 时这里会出错**——属于"复制粘贴留下的硬编码"。**自己写的时候要统一用变量。**

### 6.4 读流程：多一次"重复起始"和 ACK 管理

```c
static uint8_t msp_iic_hard_read_nbyte(uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len)
{
    // ① 起始 + 地址（写） + 寄存器地址
    ...
    /************* start ***********************/
    i2c_start_on_bus(i2cx);                       // ② 重复起始
    if (I2C_wait(I2C_FLAG_SBSEND)) return IIC_START_FAILED;

    /************* device address **************/
    i2c_master_addressing(i2cx, addr << 1, I2C_RECEIVER);   // ③ 换成"接收"方向
    if (I2C_wait(I2C_FLAG_ADDSEND)) return IIC_SEND_ADDR_FAILED;
    i2c_flag_clear(i2cx, I2C_FLAG_ADDSEND);

    i2c_ack_config(i2cx, I2C_ACK_ENABLE);
    i2c_ackpos_config(i2cx, I2C_ACKPOS_CURRENT);  // ④ 收一个字节后自动发 ACK
    if (I2C_wait(I2C_CTL0(i2cx) & I2C_CTL0_ACKEN)) return IIC_AUTO_ACK_FAILED;

    for (uint16_t i = 0; i < len; i++)
    {
        if (i == len - 1)
        {
            i2c_ack_config(i2cx, I2C_ACK_DISABLE);   // ⑤ 读最后一字节前禁用 ACK（自动 NACK）
        }
        if (I2C_wait(I2C_FLAG_RBNE)) return IIC_READ_FAILED;
        data[i] = i2c_data_receive(i2cx);
    }

    i2c_stop_on_bus(i2cx);
    while (I2C_CTL0(I2C0) & I2C_CTL0_STOP);
    i2c_ack_config(i2cx, I2C_ACK_ENABLE);
    return IIC_SUC;
}
```

**和软件实现的对应关系**：

| 软件实现 | 硬件实现 |
| --- | --- |
| 手动 `msp_iic_send_ack()` | 硬件自动（`I2C_ACK_ENABLE` + `ACKPOS_CURRENT`） |
| 最后一个字节手动 `msp_iic_send_nack()` | **提前把 ACK 关掉**，硬件自动 NACK |
| 手动切换 SDA 输入/输出 | 硬件自动（方向由 `I2C_RECEIVER` 决定） |

**硬件 I2C 最"反直觉"的一点**：**ACK 不是"发"出去的，而是提前配置好的**——你在读最后一个字节**之前**就要把 ACK 关掉。**这也是硬件 I2C 比软件 I2C 难调的原因：思维要从"一步步操作"切换成"提前配置状态机"。**

---

## 七、提交 `c2dc4c2`：软硬实现合并（本模块的设计亮点）

**问题**：现在有两套实现（软件 / 硬件），文件名、函数名都不一样（`msp_iic.c` 里一套、`msp_iic_hard.c` 里一套）。**换成哪种实现，调用方（PCF8563、OLED）就得改代码。**

**解法**：**一个宏开关 + 一层统一接口**。

```c
// msp_iic.h
// 软硬件IIC选择
// 1:硬件IIC  0:软件IIC
#define IIC_HARD_SOFT_SWITCH 0

#if IIC_HARD_SOFT_SWITCH
// 硬件IIC
#define IIC_SCL_AF GPIO_AF_4
#define SDA_AF     GPIO_AF_4
#define IIC_RCU    RCU_I2C0
#define IIC_NUM    I2C0
#define IIC_SPEED  400000
#else
// 软件IIC
#define IIC_SCL_H   gpio_bit_set(GPIOB, GPIO_PIN_6)
#define IIC_SCL_L   gpio_bit_reset(GPIOB, GPIO_PIN_6)
#define IIC_SDA_H   gpio_bit_set(GPIOB, GPIO_PIN_7)
#define IIC_SDA_L   gpio_bit_reset(GPIOB, GPIO_PIN_7)
#define IIC_SDA_IN  gpio_mode_set(GPIOB, GPIO_MODE_INPUT,  GPIO_PUPD_NONE, GPIO_PIN_7)
#define IIC_SDA_OUT gpio_mode_set(GPIOB, GPIO_MODE_OUTPUT, GPIO_PUPD_NONE, GPIO_PIN_7)
#define IIC_DELAY   delay_1us(2)
#endif
```

```c
// msp_iic.c —— 三层结构
// ============ 声    明 ============
#if IIC_HARD_SOFT_SWITCH
static void msp_iic_hard_init(void);
static uint8_t msp_iic_hard_write_nbyte(...);
#else
static void msp_iic_soft_init(void);
static uint8_t msp_iic_soft_write_nbyte(...);
#endif

// ============ 外部接口 ============    ← 只有这一层是 public 的
void msp_iic_init(void)
{
#if IIC_HARD_SOFT_SWITCH
    msp_iic_hard_init();
#else
    msp_iic_soft_init();
#endif
}

uint8_t msp_iic_write_nbyte(uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len)
{
#if IIC_HARD_SOFT_SWITCH
    return msp_iic_hard_write_nbyte(addr, reg, data, len);
#else
    return msp_iic_soft_write_nbyte(addr, reg, data, len);
#endif
}

// ============ 内部实现 ============
#if IIC_HARD_SOFT_SWITCH
... 硬件实现（static） ...
#else
... 软件实现（static） ...
#endif
```

**这套设计的四个好处**：

| 好处 | 说明 |
| --- | --- |
| **调用方零改动** | PCF8563、OLED 只调 `msp_iic_write_nbyte()`，**换实现只改头文件里那一个宏** |
| **两套实现不共存** | `#if` 保证只编译一套，**不占 Flash、不会有重复符号** |
| **对比调试方便** | 怀疑是硬件 I2C 的 bug？把宏改成 0 用软件实现跑一遍，**立刻知道问题在协议还是在外设** |
| **命名统一** | 外部接口一律 `msp_iic_xxx`，内部实现带 `_soft` / `_hard` 后缀，一眼看出职责 |

**这是本工程第 4 次使用"宏开关 + 双实现"这个模式**（前面有：串口 DMA、看门狗二选一、数码管开关）。**它特别适合"同一个功能有多种硬件方案，需要来回对比"的场景。**

**三种切换方式的对照**：

| 方式 | 例子 | 换实现要改什么 | 代价 |
| --- | --- | --- | --- |
| **编译期宏开关**（本工程） | `IIC_HARD_SOFT_SWITCH` | 改 1 个宏、重新编译 | 两套代码都要维护 |
| 运行期判断（第 04 篇串口句柄） | `if (huart->usartx == USART0)` | 改结构体成员 | 多一次判断 |
| 直接改代码 | 最早的裸写 | 改一堆函数 | 不可回退 |

### 7.1 顺手做的一处"向下适配"

`5ce9c77`（SPI OLED 软实现封装）那次提交**顺带改了 IIC 的 26 行头文件 + 70 行实现**——因为 OLED 驱动同时需要 IIC 和 SPI 两套接口，作者把两边的命名和分层统一了一遍。**这类"为了下游好写而上游重构"的动作，在真实项目中非常常见。**

---

## 八、最终代码速查

```c
// --- Hardware/msp_iic.h ---
#define IIC_HARD_SOFT_SWITCH 0        // 0=软件IIC（当前），1=硬件IIC

void    msp_iic_init(void);
uint8_t msp_iic_write_nbyte(uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len);
uint8_t msp_iic_write_col_nbyte(uint8_t addr, uint8_t reg, uint8_t *data, uint16_t offset, uint16_t len);
uint8_t msp_iic_read_nbyte(uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len);
```

**参数速查表**：

| 项目 | 软件 I2C | 硬件 I2C |
| --- | --- | --- |
| 引脚 | PB6 = SCL，PB7 = SDA | 同左（**复用 AF4**） |
| GPIO 模式 | `GPIO_MODE_OUTPUT` + `GPIO_OTYPE_OD` | `GPIO_MODE_AF` + `GPIO_OTYPE_OD` |
| 输出速度 | 2 MHz | `GPIO_OSPEED_MAX` |
| 速率 | 由 `IIC_DELAY` 决定（代码 2 μs 半周期 ≈ 250 kHz） | `IIC_SPEED` = 400 kHz |
| 外设 | 无 | `I2C0`（`RCU_I2C0`） |
| 方向切换 | 手动改 SDA 模式 | 硬件自动 |
| 超时保护 | 无（纯软件时序不会卡） | **`I2C_wait()` / `I2C_waitn()` + TIMEOUT** |

**错误码速查（`IIC_STA`）**：

| 错误码 | 含义 | 常见原因 |
| --- | --- | --- |
| `IIC_SUC` | 成功 | — |
| `IIC_SEND_ADDR_FAILED` | 设备地址没被应答 | 器件没接/地址错/上拉缺失 |
| `IIC_SEND_REG_FAILED` | 寄存器地址没被应答 | 器件中途掉线 |
| `IIC_SEND_DAT_FAILED` | 数据没被应答 | 器件缓冲满/掉线 |
| `IIC_BUS_BSY` | 总线忙 | 上一次通信没正常结束 |
| `IIC_START_FAILED` | 起始信号失败 | 总线被拉死 |
| `IIC_AUTO_ACK_FAILED` | ACK 自动应答没开起来 | 配置顺序问题 |
| `IIC_READ_FAILED` | 读一字节失败 | 从机没发数据 |

**设备地址速查**：

| 器件 | 7 位地址 | 写字节 | 读字节 |
| --- | --- | --- | --- |
| PCF8563 | `0x51` | `0xA2` | `0xA3` |
| SSD1306（IIC OLED） | `0x78` | `0xF0` | `0xF1` |

---

## 九、排查清单

| 现象 | 优先检查 |
| --- | --- |
| 打印 `IIC device not found!` | **从机地址错**（注意 7 位地址要左移 1 位）；器件没供电；SDA/SCL 接反 |
| 所有通信都失败 | **上拉电阻缺失**（开漏输出没有上拉，线永远是低）；忘了 `GPIO_OTYPE_OD` |
| 偶尔失败、时好时坏 | 上拉电阻太大导致上升沿太慢；或软件 I2C 延时太短 |
| 硬件 I2C 死机不进主循环 | 缺超时保护——`while(!flag)` 在从机无响应时死等（本工程的 `I2C_wait` 就是解决这个的） |
| 硬件 I2C 卡在某一步 | 打印/记录卡在哪个标志：`SBSEND`（起始）/`ADDSEND`（地址）/`TBE`（发数据）/`BTC`（传输完）/`RBNE`（收数据） |
| 地址被应答但读不出数据 | 忘了"重复起始 + 换读方向"；或最后一个字节没回 NACK |
| 读出来的数据总是 0xFF | 从机没驱动 SDA（地址或寄存器写错了） |
| 改了器件地址就全失败 | 忘了同步修改 `<< 1` 之后的读写字节（见速查表） |
| 从软件切到硬件（宏改 1）后不工作 | 忘了 `gpio_af_set(..., GPIO_AF_4, ...)`；或引脚不是 PB6/PB7 对应的 I2C0 复用 |
| 硬件 I2C 报 `IIC_BUS_BSY` | 上一次通信异常中断，总线被拉死；需要复位 I2C 外设或重新初始化 |
| OLED 显示花屏/错位 | 用了 `write_nbyte` 刷屏，应该用 `write_col_nbyte`（按列跨步取数） |
| `msp_iic_read_nbyte(..., 0)` 时跑飞 | `len = 0` 时 `len - 1` 下溢成 65535（真实存在的边界问题） |
| 换到 I2C1 后 STOP 等待卡住 | 代码里 `while (I2C_CTL0(I2C0) & ...)` 硬编码了 I2C0 |

## 十、自测题

1. I2C 为什么必须用开漏输出？请从"短路"和"读不回来"两个角度解释。
2. "线与"是什么意思？为什么它让多设备共线成为可能？
3. 四条时序规则分别是什么？**为什么起始/停止要用"SCL 高时 SDA 变化"这种组合**？
4. 7 位地址为什么要左移 1 位？`0x51` 设备读、写时分别是什么字节？
5. 软件 I2C 里 SDA 为什么要在输入/输出之间来回切换？SPI 为什么不用？
6. `msp_iic_wait_ack()` 里"先主动拉高 SDA"这一步有什么用？去掉会怎样？
7. ACK 和 NACK 在电平上分别是什么？为什么最后一个字节要发 NACK？
8. 为什么读操作要"重复起始"，而不是"停止后再起始"？
9. 硬件 I2C 的 `I2C_wait()` 超时封装解决了什么问题？不封装会怎样？
10. 硬件 I2C 的 ACK 为什么是"提前配置"而不是"主动发送"？这让编程思维发生了什么变化？
11. `IIC_HARD_SOFT_SWITCH` 这个宏开关带来了哪些好处？它属于哪种实现切换方式？
12. `write_col_nbyte()` 是为什么加进来的？为什么通用接口不够用？

## 十一、练习题

1. **时序实践**：用逻辑分析仪抓一次 `msp_iic_read_nbyte()` 的波形，对照第四章的 11 步流程，逐段标注（起始/地址/寄存器/重复起始/数据/ACK/NACK/停止）。
2. **超时补强**：给软件 I2C 的 `msp_iic_wait_ack()` 也加超时（现在是死等），返回专属错误码。
3. **修 bug**：① 修掉 `msp_iic_read_nbyte()` 里 `len == 0` 的下溢；② 把硬件实现里的 `I2C0` 硬编码改成 `i2cx`；③ 让 `msp_iic_wait_ack()` 失败时也把 SCL 拉低。
4. **扫描总线**：写一个 `iic_scan()`，遍历 7 位地址 1~127，逐个发地址并看应答，把响应到的地址打印出来（这是排查"器件到底在不在"最有效的工具）。
5. **对比实验**：把 `IIC_HARD_SOFT_SWITCH` 在 0/1 之间切换，各跑一次"读 PCF8563 时间"，用逻辑分析仪对比两者的波形差别（速率、SCL 占空比、时钟拉伸）。
6. **调延时**：把 `IIC_DELAY` 从 `delay_1us(2)` 改成 `delay_1us(1)` 和 `delay_1us(10)`，看通信是否还稳定，理解"延时宁长勿短"。
7. **加器件**：给总线再挂一个 I2C 传感器（如 AHT20），复用 `msp_iic_read_nbyte()` 把数据读出来。

---

## 附：提交清单

| 提交 | 日期 | 说明 | 关键改动 |
| --- | --- | --- | --- |
| `7711e72` | 09-26 18:03 | [更新] IIC软实现 | 新建 `Hardware/msp_iic/msp_iic.c/h`（+143/+27）：引脚宏 + `SDA_IN/OUT` 切换 + `IIC_DELAY` + 起始/停止/收发字节/ACK；外部接口 `msp_iic_config()` + `msp_iic_write_nbyte()`；`main.c` 接入初始化 |
| `ae57848` | 09-28 10:30 | [更新] IIC软实现 与 pcf8563 通信 | 补 `msp_iic_read_nbyte()`（+122 行）：重复起始 + 换读方向 + 末字节 NACK；`main.c` 开始读 PCF8563 |
| `d3a0319` | 09-28 15:58 | [更新] IIC硬实现 与 pcf8563 通信 | 新建 `Hardware/msp_iic/msp_iic_hard.c/h`（+210/+10）：AF4 复用 + I2C0 400 kHz + `I2C_wait/I2C_waitn` 超时封装 + 五标志位流程 |
| `c2dc4c2` | 09-28 21:23 | [更新] IIC软硬实现合并 | 引入 `IIC_HARD_SOFT_SWITCH` 宏；`msp_iic.c` 重构为"声明 / 外部接口 / 内部实现"三段（+311/-37）；`msp_iic.h` 统一两套宏（+58）；删掉独立的 hard 文件编译项 |
| `5ce9c77` | 10-06 17:44 | [更新] SPI OLED 软实现 封装（**跨模块改动**） | 顺带整理 IIC 的命名与分层（`msp_iic.c` 70 行、`msp_iic.h` 26 行），为 OLED 同时使用 IIC/SPI 做准备 |
| `886ba18` | 09-29 12:00 | [更新] IIC OLED 显示 pcf8563 时间（**跨模块改动**） | 新增 `msp_iic_write_col_nbyte()`（+113 行）：按 `offset` 跨步取数，服务 OLED 按页刷屏 |
| —— | 10-15 | [更新/修复] SC12B 触摸按键（**本模块第 4 个使用场景，跨模块改动**） | `bsp_touch_key` 只用 `msp_iic_read_nbyte` / `msp_iic_write_nbyte` 两个通用接口，**IIC 侧一行没改** ✅；详见 [第 31 篇](31-触摸按键SC12B.md) |

**这六次提交走的三级台阶**

| 台阶 | 提交 | 解决了什么 |
| --- | --- | --- |
| 1. 能用 | `7711e72` `ae57848` | 软件 I2C 跑通读写 |
| 2. 更快 | `d3a0319` | 硬件 I2C（400 kHz）+ 超时保护 |
| 3. 好切 | `c2dc4c2` `5ce9c77` `886ba18` | 宏开关统一接口、命名整理、为下游器件加专用接口 |
| **4. 加设备不改总线** | `ccb3c81`（PCF8563）、`e941ecb`（OLED）、**`2bdc21f`（SC12B 触摸）** | **三次加新器件、`msp_iic` 一次都没被改动**——这才是"总线抽象"该有的样子 ✅ |

## 参考笔记

- `../../../NOTE/Note/IIC.md` —— IIC（I2C）总线（完整整理版）
  - 第二章「为什么必须开漏 + 上拉」= 本篇第二章
  - 第三章「数据有效性规则」= 本篇第三章
  - 第四章「一次完整通信的流程」= 本篇第四章
  - 第五章「软件 I2C：逐行实现」= 本篇第五章
  - 第六章「硬件 I2C」= 本篇第六章
  - 第七章「实战一：软件 I2C 驱动 OLED」= 第 18 篇
  - 第八章「实战二：软件 I2C 驱动 PCF8563」= 第 17 篇
  - 第九章「配置速查」= 本篇第八章
- `../../../NOTE/Textbook/IIC/` —— 教材原文快照：`I2C原理.mhtml`、`I2C软实现🌟🌟🌟.mhtml`、`I2C硬实现.mhtml`、`GD32F4的I2C查询.mhtml`、`I2C屏幕案例.mhtml`、`I2C时钟案例.mhtml`

> 本笔记仅作学习整理，内容来自本仓库真实提交记录与源码。
