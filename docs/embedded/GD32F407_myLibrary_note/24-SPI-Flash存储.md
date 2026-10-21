# 24 · SPI Flash 存储（GD25Q32 / W25Qxx）· 学习笔记

> 这一篇讲 **2 次提交**：`915f21f`（移植官方 GD25Q32 例程，能读能写）→ `18cec36`（封装改造：改名 `bsp_flash_*`、SPI 初始化改走 `msp_spi`）。
> 这是本工程**第 5 类外设**——片外**存储器**，也是 SPI 总线上的**第三个用户**（前两个是 SPI OLED 和 LCD）。
> 整理日期：2026-10-07　｜　提交范围：`915f21f`、`18cec36`

## 怎么读这份笔记

| 你的情况 | 建议路线 |
| --- | --- |
| 只想知道怎么用 | 第六章速查表 + `bsp_flash_read()` / `bsp_flash_write()` |
| 读出来全是 `FF` 或 `00` | 第八章排查清单第 1~4 条（**先查 CS 和 SPI 有没有初始化**） |
| 想搞清楚「为什么改一个字节要等 45 ms」 | 第七章时序表 + 第二章容量组织 |
| 想移植到 W25Q128/W25Q64 | 第二章 §2.4「同族芯片速查」+ 第八章第 6 条 |
| 想知道官方例程长什么样 | 第三章「两条实现路线对照」（本机固件库里就有官方 `gd25qxx.c`） |

## 知识点地图

```
SPI Flash（本篇）
├── 一、为什么要外挂存储器        易失/非易失、RAM/ROM/EEPROM/NOR/NAND
├── 二、GD25Q32 是什么            容量组织（页/扇区/块）、引脚、指令集、同族对照
├── 三、两条实现路线对照          官方 gd25qxx.c（0x9F，连续轮询） vs 本工程 bsp_flash.c（0x90，逐次轮询）
├── 四、提交演进                  915f21f 移植（自带 SPI 初始化） → 18cec36 封装（复用 msp_spi）
├── 五、最终代码逐段解读          7 个函数：init / read_id / write_enable / wait_busy / erase / write / read
├── 六、最终代码速查              接口、指令、地址换算
├── 七、时序是这里最大的坑        擦除 45 ms、编程 0.7 ms、读 5 µs —— 差 4 个数量级
├── 八、排查清单                  现象 → 原因
└── 九、自测题 + 练习题
```

## 学习目标

1. 说清「为什么 Flash 必须先擦后写」，以及「擦除的单位是扇区、写入的单位是页」这两件事带来什么后果。
2. 能独立写出「读 ID → 写使能 → 等待忙 → 擦扇区 → 写页 → 读回校验」这套最小闭环。
3. 看懂本工程 2 次提交分别解决了什么问题，特别是**为什么第二次要把自带 SPI 初始化整段注释掉**。
4. 记住 SPI Flash 的耗时在**物理擦写**而不是**总线速度**，并算出它和看门狗/主循环调度的冲突。

---

## 一、为什么要外挂一颗存储器

### 1.1 易失 vs 非易失

| 分类 | 断电后 | 代表 | 本工程角色 |
| --- | --- | --- | --- |
| **易失（RAM）** | 数据**丢失** | SRAM / SDRAM / DDR | GD32F407 内部 192 KB SRAM，跑程序用 |
| **非易失（ROM/Flash）** | 数据**保留** | Flash / EEPROM | 存程序（内部 Flash）、存数据（本篇的片外 Flash） |

GD32F407VET6 内部有 **512 KB Flash**（存程序）+ 192 KB SRAM，但**都不适合存"运行中产生的数据"**：

- 内部 Flash 要"顺便"存程序，擦写它容易把自己正在执行的代码擦掉（而且擦写寿命只有约 1 万次）；
- 需要存的是**配置、日志、字库、图片**这类断电也不能丢的数据。

所以就有了这颗**片外 SPI Flash**。

### 1.2 Flash 的家族关系（教材《存储器介绍》的骨架）

```
存储器
├─ 易失   RAM ── DRAM（SDRAM / DDR / DDR2 / DDR3）、SRAM
└─ 非易失 ROM ── MASK ROM、PROM/EPROM/OTPROM、EEPROM
            └─ FLASH ── NOR FLASH（≡本篇这颗）、NAND FLASH
```

三个关键区别：

| | EEPROM | NOR Flash | NAND Flash |
| --- | --- | --- | --- |
| 擦除单位 | **字节** | 扇区/块 | 块 |
| 能否按字节随机读 | 能 | **能**（所以程序可以直接在 NOR 上跑） | 不能，按页读 |
| 容量/成本 | 小、贵 | 中 | 大、便宜 |
| 擦写寿命 | 约 100 万次 | 约 10 万次 | 约 10 万次（有坏块管理） |
| 典型接口 | I2C / SPI | **SPI**（本篇）、并口、Quad | 并口、ONFI |

> **一句话结论**：要"按字节改一点小数据"选 EEPROM（内部的 PCF8563 里就有一小块，见第 17 篇）；要"大块存、顺序写"选 NOR Flash（本篇）。

---

## 二、GD25Q32 是什么

### 2.1 容量与组织

| 项目 | 数值 | 换算 |
| --- | --- | --- |
| 标称容量 | **32 Mbit** | = 4 MByte = 4096 KB |
| 页 Page | 256 B | 4096 KB / 256 B = **16384 页** |
| 扇区 Sector | 4 KB | 4096 KB / 4 KB = **1024 个扇区** |
| 块 Block | 64 KB（也有 32 KB 的块） | 4096 KB / 64 KB = **64 个块** |
| 地址宽度 | **24 位**（3 字节） | 0x000000 ~ 0x3FFFFF |

**这三个"单位"是理解整个驱动的前提**：

```
一次擦除最小 = 1 个扇区 = 4 KB（不能只擦 1 个字节！）
一次写入最大 = 1 页     = 256 B（超过就回卷到本页开头！）
一次读取无限制         = 给地址就一直读下去
```

> ⚠️ 代码里 `bsp_flash_erase_sector()` 的注释写着「`addr=擦除的扇区号，范围=0~15`」——
> 0~15 这个范围是 **64 KB 容量芯片**（16 个扇区）才成立。GD25Q32 有 **1024 个扇区（0~1023）**，
> W25Q128 有 **4096 个扇区**。**这条注释是从别处抄来的，直接忽略了容量差异**（第八章第 6 条）。

### 2.2 引脚（8 脚 SOP-8）

| 引脚 | 名称 | 方向 | 说明（教材原文） |
| --- | --- | --- | --- |
| 1 | **CS** | 输入 | **高电平时其它引脚高阻态；低电平时才能读写** |
| 2 | DO | 输出 | 串行数据输出，**时钟下降沿输出** |
| 3 | WP | 输入 | 写保护，有效时禁止写（低有效） |
| 4 | GND | — | 地 |
| 5 | DI | 输入 | 串行数据输入，**时钟上升沿采样** |
| 6 | CLK | 输入 | 时钟 |
| 7 | HOLD | 输入 | 暂停保持（低有效），允许芯片暂停工作 |
| 8 | VCC | — | 3.3 V |

> 「DO 在**下降沿**输出、DI 在**上升沿**采样」→ 这就是 **SPI Mode 0**（CPOL=0 空闲低 + CPHA=0 前沿采样）的定义。
> 所以**软件 SPI 的 `msp_spi_read_write_byte()`（SCL 低写、SCL 高读）天然就是对的**；
> 硬件分支用的 `SPI_CK_PL_HIGH_PH_2EDGE`（Mode 3）**也能用**——W25Q/GD25Q 系列两种 Mode 都支持
> （见第 16 篇第三章，以及第八章第 5 条里那个"两种 Mode 并存"的遗留）。

### 2.3 指令集（用到的 7 条）

| 指令 | 码 | 后面跟 | 作用 |
| --- | --- | --- | --- |
| Write Enable | `06h` | — | 置 WEL 位；**每次擦/写之前都必须发一次** |
| Read Status Reg | `05h` | → 1 字节 | 读状态寄存器，**bit0 = WIP（忙）** |
| Read Data | `03h` | 3 字节地址 + 数据 | 普通读，无频率上限直到几十 MHz |
| Page Program | `02h` | 3 字节地址 + ≤256 B | 编程一页 |
| Sector Erase | `20h` | 3 字节地址 | 擦除 4 KB 扇区（**一个扇区只能整块擦**） |
| Read Manufacturer / Device ID | `90h` | 3 字节 0 + 读 2 字节 | **本工程用的就是它**，返回 制造商ID + 设备ID |
| Read Identification (JEDEC) | `9Fh` | 读 3 字节 | **官方例程用的是它**，返回 制造商 + 存储类型 + 容量 |

一次性指令与地址型指令的区别：**擦除/编程的 3 字节地址是"绝对字节地址"**，而 `bsp_flash_erase_sector()` 收的却是"扇区号"，所以它内部要 `addr *= 4096`——这是本篇最容易看错的一处（见 §5.5）。

### 2.4 同族芯片速查

| 型号 | 容量 | 扇区数(4KB) | 页数 | 90h 设备 ID |
| --- | --- | --- | --- | --- |
| GD25Q16 | 2 MB | 512 | 8192 | `14h` |
| **GD25Q32**（本篇） | **4 MB** | **1024** | **16384** | **`15h`** |
| GD25Q64 | 8 MB | 2048 | 32768 | `16h` |
| GD25Q128 | 16 MB | 4096 | 65536 | `17h` |
| W25Q128（教材用它举例） | 16 MB | 4096 | 65536 | `17h`（制造商 `EFh`） |

> 制造商 ID：本工程这颗是 **GigaDevice → `C8h`**；教材举例的 W25Q 是 **Winbond → `EFh`**。
> 所以串口应该打印 `ID = C815`（制造商 `C8` + 设备 `15`）。
> **具体数值以你手上芯片的手册 `Read Manufacturer/Device ID` 表为准**——但判据很好用：
> **只要高位是 `C8`（或 `EF`），就说明 Flash 已经应答了**；`FFFF`/`0000` 才是接线或时序问题。

---

## 三、两条实现路线对照

本机的固件库里**就带着官方驱动**，可以直接对照（这是"查资料"最省力的一条路）：

```
NOTE/Doc/GD32F407/GD32F4xx_Firmware_Library_V3.2.0/
        Examples/USB/USB_Device/dev_firmware_update/
        ├── inc/gd25qxx.h
        └── src/gd25qxx.c
```

| 对比项 | 官方 `gd25qxx.c` | 本工程 `bsp_flash.c` |
| --- | --- | --- |
| 读 ID 指令 | `9Fh`（JEDEC，读 3 字节） | `90h`（读 2 字节） |
| ID 返回 | 24 位：制造商 + 类型 + 容量 | 16 位：制造商 + 设备 |
| 忙检测时 CS | **拉低一次，连续读状态**（循环里只发 dummy） | **每轮都拉高再拉低、重发 `05h`** |
| 擦除接口 | 分开给：`sector_erase` / `block_erase` / `bulk_erase` | 只给 `sector_erase`（4 KB） |
| 块擦除单位 | 注释写 **32 KB**（`SPI_FLASH_BLOCK_SIZE 0x8000`） | 无 |
| 收发函数 | `spi_flash_send_byte()`（8 位全双工） | `msp_spi_read_write_byte()`（同样的东西） |
| 写保护 | 有 `spi_quad_flash_quad_enable()`（QSPI） | 无 |
| 依赖 | 直接用 `SPI_FLASH_CS_LOW/HIGH` 宏绑死在 `GPIOI, PIN_8` | CS 用宏绑在 `GPIOA, PIN_4`，SPI 部分**解耦给 `msp_spi`** |

**两边都合法的差异不必统一**（比如 `9Fh` vs `90h`）；但**性能与风格上的差异值得学**：

- 官方在 `wait_for_write_end()` 里**只拉低一次 CS，然后连续读状态寄存器**——一轮擦除期间几百次轮询都不重新发指令；
- 本工程每轮都"CS 高 → CS 低 → 发 `05h`"（一个完整的读事务）——**功能正确但每次多花 4 个字节的时钟**。
  对 45 ms 的擦除来说这点开销可忽略，但它是"**懂得协议边界**"和"**照着抄**"的区别。
- 官方代码里那条 `SPI_FLASH_BLOCK_SIZE = 0x8000`（32 KB）说明**块擦除不止 64 KB 一种**，
  教材只讲了 64 KB ——**手册的 Block Erase 表里 32 KB/64 KB 两行都要看**。

---

## 四、提交演进

### 4.1 `915f21f`：移植官方例程（10-07 10:40）

**做了什么**：新建 `Driver/bsp_flash/`（`.c` 226 行 + `.h` 32 行），`main.c` 加 `flash_test()`，`eide.yml` 加一行源文件 + 一行包含路径。

**这一版的三个特征**（都是"移植"的典型痕迹）：

1. **命名直接沿用例程**：`GD25Q32_readID()` / `GD25Q32_write()` —— 而本工程的 Driver 层惯例是**小写 `bsp_xxx_`**（`bsp_leds_config`、`bsp_buzzer_set_freq`）。
2. **SPI 初始化自带一份**：`bsp_spi_init()` 里把 `RCU_SPI0`、`PA5/PA6/PA7` 复用、`spi_parameter_struct` 全配了一遍 —— 但这套代码 `msp_spi.c` 里**早就有**。
3. **CS 引脚单独配**：`PA4` 配成推挽输出 + **内部上拉**（`GPIO_PUPD_PULLUP`）后拉高（不选中）。

```c
// 915f21f 的 main.c
// #include "msp_spi.h"        ← 注释掉
#include "bsp_flash.h"         ← 改用它
...
// msp_spi_init();             ← 注释掉
bsp_spi_init();                ← Flash 自己的 SPI 初始化
```

**后果**：SPI0 被初始化了两套配置（一个 21 MHz Mode 3，另一个也是 21 MHz Mode 3，暂时"碰巧一致"）；
如果哪天 SPI OLED 改了分频或极性，Flash 就会跟着出问题——**两份配置各自为政**。

### 4.2 `18cec36`：封装改造（10-07 17:55）

**这次提交就是"把它改成本工程的样子"**，三处动作：

**① 改名**：`GD25Q32_*` → `bsp_flash_*`，`bsp_spi_init` → `bsp_flash_init`。
同时把 `bsp_flash.h` 里那一堆 SPI 引脚宏（`BSP_SPI_SCK/MISO/MOSI`、`BSP_GPIO_AF`、`BSP_SPI_RCU`）**全部注释掉**。

**② 去掉自己的 SPI 初始化**：`bsp_flash_init()` 只剩"配 CS 引脚 + 拉高不选中"，
SPI 的初始化交回 `msp_spi.c`；`main.c` 里恢复 `msp_spi_init()` 的调用。

```c
// bsp_flash_init() 现在只剩这些（其余 50 行全被注释）
rcu_periph_clock_enable(BSP_GPIO_RCU);
rcu_periph_clock_enable(BSP_SPI_NSS_RCU);
gpio_mode_set(BSP_GPIO_PORT, GPIO_MODE_OUTPUT, GPIO_PUPD_PULLUP, BSP_SPI_NSS);
gpio_output_options_set(BSP_GPIO_PORT, GPIO_OTYPE_PP, GPIO_OSPEED_50MHZ, BSP_SPI_NSS);
gpio_bit_write(BSP_GPIO_PORT, BSP_SPI_NSS, SET);
```

**③ 给 `msp_spi` 补一个"真·全双工"接口**：这是本次提交最值得看的部分。

原来的 `msp_spi` 只有"只写"（`msp_spi_write_byte`）和"只读"（`msp_spi_read_byte`，内部发 `0x00`），
而 Flash 的**每个事务都是"边写边读"**（发命令的同时就要读回 ID/状态/数据）。而且原来的"只读"会**额外多跑 8 个时钟**：

```c
// 旧：读一个字节 = 先发 0x00 一个字节，再读 —— 交互式器件受不了
uint8_t msp_spi_read_byte(void)  { 发 0x00; 收 1 字节; }

// 新：一次 8 个时钟，同时收和发 —— SPI 的本义
uint8_t msp_spi_read_write_byte(uint8_t byte)
{
    // 软件实现：SCL 拉低写 MOSI → SCL 拉高读 MISO（Mode 0）
    // 硬件实现：TBE 就绪 → transmit → RBNE 就绪 → receive
}
```

顺手还删掉了 `bsp_flash.h` 里那句 `#define spi_read_write_byte(byte) msp_spi_read_write_byte(byte)` 的**改名宏**——
用宏去"假装"函数名，是这个工程里反复出现的"低成本改造"手法（第 18 篇 OLED 侧也用同一招：`#define OLED_WRITE_BYTE msp_spi_write_byte`）。

> **一句话总结两次提交**：
> `915f21f` 让 Flash **能跑**（照抄官方，自带一切）；`18cec36` 让 Flash **归队**（改名、复用 SPI 抽象层、补全双工接口）。
> 这正是本项目 12 个模块共同的重构套路：**先能跑，再把重复的初始化交回公共层**。

---

## 五、最终代码逐段解读

### 5.1 `bsp_flash_init()` —— 只负责"不选中"

```c
void bsp_flash_init(void)
{
    rcu_periph_clock_enable(BSP_GPIO_RCU);      // GPIOA 时钟
    rcu_periph_clock_enable(BSP_SPI_NSS_RCU);   // （同一组，重复一次，无害）
    gpio_mode_set(GPIOA, GPIO_MODE_OUTPUT, GPIO_PUPD_PULLUP, GPIO_PIN_4);
    gpio_output_options_set(GPIOA, GPIO_OTYPE_PP, GPIO_OSPEED_50MHZ, GPIO_PIN_4);
    gpio_bit_write(GPIOA, GPIO_PIN_4, SET);     // CS = 高 = 不选中
}
```

**调用顺序有讲究**：`main.c` 里 `msp_spi_init()` 在前、`bsp_flash_init()` 在后。
先让 SPI 把 PA5/PA6/PA7 配成 SPI 状态，再单独配 CS —— 两者互不干扰。

> `GPIO_PUPD_PULLUP` 对**输出**脚其实没有上拉作用（内部上下拉只在输入模式生效），
> 这里写它属于"照抄例程"；真正有意义的是**上电瞬间 CS 不能是低**——
> 芯片规格要求 CS 在电源稳定前保持高，否则可能误进入某条指令。**靠 `gpio_bit_write(..., SET)` 保证。**

### 5.2 `bsp_flash_read_id()` —— 唯一的"自检"手段

```c
uint16_t bsp_flash_read_id(void)
{
    uint16_t temp = 0;
    W25QXX_CS_ON(0);                            // CS 低：开始事务
    spi_read_write_byte(0x90);                  // 指令：读制造商/设备 ID
    spi_read_write_byte(0x00);                  // 3 字节"假地址"（90h 要求）
    spi_read_write_byte(0x00);
    spi_read_write_byte(0x00);
    temp  = spi_read_write_byte(0xFF) << 8;     // 读制造商 ID（发什么无所谓）
    temp |= spi_read_write_byte(0xFF);          // 读设备 ID
    W25QXX_CS_ON(1);                            // CS 高：结束事务
    return temp;
}
```

三个细节：

1. `0x90` 后面必须跟 **3 个地址字节**（内容不重要，通常 0），少了就整个错位；
2. 读的时候"发送"的 `0xFF` **只是时钟（dummy）**，从机不关心——**SPI 是全双工，你不发就没有时钟**；
3. **`CS` 拉高才结束这次读**，否则芯片会一直往下吐数据。

> 这也是 SPI 与 I2C 的根本差别（第 22 篇）：**I2C 从机每字节应答（ACK），SPI 没有任何应答**。
> 所以 SPI 器件只能靠"**读回 ID / 读状态寄存器**"来证明它还活着——`read_id()` 就是这条"生命线"。

### 5.3 `bsp_flash_write_enable()` —— 09h 家族的通行证

```c
void bsp_flash_write_enable(void)
{
    W25QXX_CS_ON(0);
    spi_read_write_byte(0x06);   // WREN
    W25QXX_CS_ON(1);
}
```

**规则**：任何"会改变芯片内容"的指令（`02h` 编程、`20h` 擦除、`01h` 写状态寄存器）执行前，
都必须先发一次 `06h`，把状态寄存器的 **WEL 位置 1**。指令结束后 WEL **自动清零** ——
所以**每写一次就要发一次**，不能"发一次管一天"。

### 5.4 `bsp_flash_wait_busy()` —— 唯一的"同步"手段

```c
void bsp_flash_wait_busy(void)
{
    unsigned char byte = 0;
    do {
        W25QXX_CS_ON(0);
        spi_read_write_byte(0x05);          // RDSR：读状态寄存器
        byte = spi_read_write_byte(0xFF);   // bit0 = WIP（1 = 正在干活）
        W25QXX_CS_ON(1);
    } while ((byte & 0x01) == 1);
}
```

- **为什么需要它**：擦除/编程是**芯片内部的高压操作**，MCU 发完指令就可以走人，但芯片还在忙；
  期间**只接受 `05h`（读状态）**，别的指令一律不理。所以"发完就拉倒"必然失败。
- **为什么它是"同步手段"**：这是整篇代码里唯一一处**被动等硬件**的地方（`while` 轮询），
  也是**所有耗时问题的根源**（第七章会说它带来多少毫秒）。
- **与官方实现的差别**：官方在 CS 拉低的状态下**连续读**（只发 dummy），本工程每轮重发 `05h`。
  两者都符合手册（CS 高电平结束读事务），但重发版把"事务"切碎了——**功能对，效率低**。

### 5.5 `bsp_flash_erase_sector()` —— 注意参数是"扇区号"！

```c
void bsp_flash_erase_sector(uint32_t addr)   // ← 参数名骗人：其实是扇区号
{
    addr *= 4096;                            // 换算成字节地址
    bsp_flash_write_enable();                // 06h
    bsp_flash_wait_busy();                   // 此时没有正在进行的操作，立即返回（冗余但无害）
    W25QXX_CS_ON(0);
    spi_read_write_byte(0x20);               // 20h：扇区擦除
    spi_read_write_byte((uint8_t)(addr >> 16));
    spi_read_write_byte((uint8_t)(addr >> 8));
    spi_read_write_byte((uint8_t)addr);      // 24 位地址，高→中→低
    W25QXX_CS_ON(1);                         // ★ CS 上升沿真正启动擦除
    bsp_flash_wait_busy();                   // 等擦完（几毫秒 ~ 几百毫秒）
}
```

**三个必须记住的点**：

1. **参数是扇区号**（`bsp_flash_write` 内部做 `addr / 4096` 才得到它），
   和其它函数的"字节地址"语义不一致——**这是最容易读错的一个函数**；
2. `bsp_flash_write_enable()` 后面的那次 `wait_busy()` **是多余的**（还没有开始任何操作），
   真正起作用的是 **末尾那次** `wait_busy()`；
3. **`CS` 拉高的上升沿是"发令枪"**：`20h + 地址` 只是把指令装进芯片，**CS 一抬高才开始擦**。
   ——所有"写完没效果"的现场，十有八九是 CS 忘了拉高。

### 5.6 `bsp_flash_write()` —— 先擦后写

```c
void bsp_flash_write(uint8_t *buffer, uint32_t addr, uint16_t numbyte)
{
    bsp_flash_erase_sector(addr / 4096);   // ① 先把这块 4 KB 全擦成 0xFF
    bsp_flash_write_enable();              // ② 06h
    bsp_flash_wait_busy();                 // ③ 等擦除结束
    W25QXX_CS_ON(0);
    spi_read_write_byte(0x02);             // ④ 02h：页编程
    spi_read_write_byte((uint8_t)(addr >> 16));
    spi_read_write_byte((uint8_t)(addr >> 8));
    spi_read_write_byte((uint8_t)addr);
    for (i = 0; i < numbyte; i++)
        spi_read_write_byte(buffer[i]);    // ⑤ 连续写数据
    W25QXX_CS_ON(1);                       // ⑥ CS 上升沿启动编程
    bsp_flash_wait_busy();                 // ⑦ 等编完
}
```

**为什么必须"先擦后写"**：Flash 的存储单元**只能把 1 写成 0，不能把 0 写回 1**；
擦除是唯一能把 0 变回 1 的操作，而擦除的最小单位是 **4 KB 扇区**。
于是：**改 1 个字节 = 擦掉 4 KB + 重写这 4 KB**。

这条特性带来两个"课本不会讲、但一定会踩"的后果：

| 后果 | 说明 | 本工程的现状 |
| --- | --- | --- |
| **① 覆盖写会误删邻居** | `write("A", 0x0000)` 再 `write("B", 0x0010)`，第二次会把扇区 0 擦掉，"A" 也没了 | ⚠️ 代码就是这样：**每次 write 都无脑擦整个扇区**（第八章第 2 条） |
| **② 跨页写会回卷** | 一页只有 256 B；从 0x00F0 开始写 32 字节，后 16 字节会**绕回 0x0000** | ⚠️ 代码没有页边界检查（第八章第 4 条） |

正确的工程做法是"**读-改-写**"或"**日志式写入**"（先把整个扇区读到 RAM，改一个字节，擦，再整块写回）。

### 5.7 `bsp_flash_read()` —— 唯一没有长度限制的操作

```c
void bsp_flash_read(uint8_t *buffer, uint32_t read_addr, uint16_t read_length)
{
    W25QXX_CS_ON(0);
    spi_read_write_byte(0x03);                     // 03h：读数据
    spi_read_write_byte((uint8_t)(read_addr >> 16));
    spi_read_write_byte((uint8_t)(read_addr >> 8));
    spi_read_write_byte((uint8_t)read_addr);
    for (i = 0; i < read_length; i++)
        buffer[i] = spi_read_write_byte(0xFF);     // 一直读，地址自动递增
    W25QXX_CS_ON(1);
}
```

读**不需要**写使能、不需要等忙、可以跨页跨扇区一路读到底（地址自动递增）。
唯一的限制是 `read_length` 是 `uint16_t`（最大 65535 字节）——想读更多要分段。

> **补充**：`03h` 普通读有频率上限（GD25Q32 手册给 **50 MHz** 量级），
> 更高频要用 `0Bh`（Fast Read，读之前要发 1 个 dummy 字节）或 `6Bh`（Quad）。本工程 **21 MHz**，用 `03h` 完全够。

---

## 六、最终代码速查

### 6.1 接口与指令

| 函数 | 指令 | 是否需先 `06h` | 是否需等忙 | 耗时量级 |
| --- | --- | --- | --- | --- |
| `bsp_flash_init()` | — | — | — | µs |
| `bsp_flash_read_id()` | `90h` | 否 | 否 | µs |
| `bsp_flash_write_enable()` | `06h` | — | 否 | µs |
| `bsp_flash_wait_busy()` | `05h` | 否 | — | 取决于正在进行的操作 |
| `bsp_flash_erase_sector(扇区号)` | `20h` | **是** | **是** | **几十 ms** |
| `bsp_flash_write(buf, 字节地址, 长度)` | `02h` | **是** | **是** | **几十 ms**（含擦除） |
| `bsp_flash_read(buf, 字节地址, 长度)` | `03h` | 否 | 否 | **µs** |

### 6.2 地址换算（背下来）

```
扇区号 = 字节地址 / 4096        字节地址 = 扇区号 × 4096
页  号 = 字节地址 / 256         页内偏移 = 字节地址 % 256
块  号 = 字节地址 / 65536
容量   = 4 MB = 0x400000（24 位地址上限 0x3FFFFF）
```

### 6.3 本工程的调用示例（`flash_test()`）

```c
unsigned char buff[20] = {0};
printf("ID = %X\r\n", bsp_flash_read_id());     // 期望 C815
bsp_flash_read(buff, 0, 10);                    // 读前 10 字节（新片应全 FF）
printf("buff: %s\r\n", buff);
delay_1ms(200);
bsp_flash_write((uint8_t *)"hello", 0, 10);     // 写 "hello"
delay_1ms(200);
bsp_flash_read(buff, 0, 10);                    // 读回校验
printf("buff: %s\r\n", buff);
delay_1ms(1000);
```

> ⚠️ `bsp_flash_write((uint8_t *)"hello", 0, 10)` 要写 **10 字节**，而字符串字面量 `"hello"` 只有 **6 字节**
> （5 个字符 + `'\0'`）——**越界读取 4 个字节**（未定义行为）。正确写法是 `6` 或 `sizeof("hello") - 1`。
> 另外 `printf("%s", buff)` 依赖 `buff` 里有 `\0`：本行恰好因为 `{0}` 初始化和"读到的是 `FF`"，所以能停住——
> 属于**蒙对了**，不是写对了。（第八章第 1、3 条）

---

## 七、时序是这里最大的坑

### 7.1 三个数量级差

| 操作 | 手册标称（typ / max，需自行核对手册） | 本工程 SPI 21 MHz 下的"通信时间" |
| --- | --- | --- |
| 读 14 字节（ID 事务） | 无额外时间 | $14 \times 8 / 21\text{ MHz} \approx 5.3\ \mu s$ |
| 编程 256 B 页 | **0.7 ms / 3 ms** | 264 B ≈ 100 µs |
| **擦除 4 KB 扇区** | **45 ms / 400 ms** | 4 字节 ≈ 1.5 µs |
| 擦除 64 KB 块 | 约 150 ms / 2 s | 同上 |
| 芯片全擦 | 约 10 s 量级 | 同上 |

**结论**：**擦一个扇区 45 ms，而命令本身只花 1.5 µs —— 99.997% 的时间在等芯片内部的高压电路。**

所以：

> **SPI Flash 的性能瓶颈从来不是总线速度，而是擦写的物理时间。**
> 想"更快"，提高 SPI 时钟毫无用处，只能**减少擦除次数**（攒够一整扇区再写 / 用日志式追加写）。

### 7.2 和看门狗/主循环的冲突（跨模块）

`flash_test()` 里的总阻塞时间：

```
delay_1ms(200) + 擦+编程(约 46 ms) + delay_1ms(200) + 读(µs) + delay_1ms(1000)  ≈  1.45 s
```

对照第 12 篇、第 13 篇算过的看门狗窗口：

| 看门狗 | 允许的最大间隔 | 运行 `flash_test()` 的后果 |
| --- | --- | --- |
| **FWDGT**（超时 100 ms） | 100 ms | **必然复位**（1.45 s ≫ 100 ms） |
| **WWDGT**（窗口 4.58~6.24 ms） | 必须在窗口内喂 | **更早复位**（45 ms 的擦除就已超出窗口 7 倍） |

> 目前 `main.c` 里两个看门狗都是**注释状态**（`// msp_fwdgt_config(); // msp_wwdgt_config(); // 前面的初始化会消耗时间`），
> 所以现在不会复位。**但这说明"打开看门狗"和"用 Flash 存数据"是必须一起设计的两件事**：
> 正确做法是把擦写拆成"发指令 → 返回 → 主循环里等忙 → 完成"，**让等待变成非阻塞的**（和第 05 篇的状态机是同一个思路）。

### 7.3 谁在总线上等："轮到我才发"

同一时刻 **CS 只能有一个是低的**。本板的 SPI0 总线上挂着三个器件：

```
            PA5 (SCK) ──┬──── U4  SPI-OLED   (CS = PA3)
            PA7 (MOSI)──┼──── U10 LCD        (CS = ?)
                        └──── U?  GD25Q32     (CS = PA4)
            PA6 (MISO) ────── GD25Q32        (只有它会"回话")
```

**推论**：

1. **SCK/MOSI 是共享的**，所以"任何时刻只能有一个 CS 有效"——OLED 刷新和 Flash 读写不能并发（裸机天然满足）；
2. **MISO 只有 Flash 用**（OLED 侧那句 `OLED_READ_FS0()` 是注释掉的），所以 Flash 的"回话"不会被别人抢；
3. **PA4 在原理图上只连到 P3 排针（`PA4 :: P3.5, U9.5`），板上 BOM 里没有任何 Flash 器件**——
   说明这颗 GD25Q32 是**外接模块**，通过排针接到 `CS=PA4` 上。
   这一点很关键：**代码能编译、能跑通 `ID = C815` 的前提是"模块插上了"**，
   没插就得到 `FFFF`（第八章第 1 条）。
   *（`Doc/硬件信息汇总.md` 的 5.4 节列了"硬件已具备但代码未实现"，本篇正好是反过来的情形：**代码已实现，硬件靠外接**。）*

---

## 八、排查清单

| # | 现象 | 最可能的原因 | 怎么验证 |
| --- | --- | --- | --- |
| 1 | `ID = FFFF` 或 `0` | ① 模块没插/CS 没接 ② `msp_spi_init()` 没调用 ③ CS 引脚不是 PA4 | 万用表量 CS 静态应为 3.3 V；打点看 `msp_spi_init()` 有没有执行 |
| 2 | `ID` 正常，但写进去读不出来 | ① 扇区没擦就写（`0` 不能写回 `1`）② `06h` 漏发 ③ **`CS` 忘了拉高**（指令没真正启动） | 读回来和数据比对：若结果 = 旧值 AND 新值，就是"没擦" |
| 3 | 写 A 之后 B 没了 | `bsp_flash_write()` **每次都擦整个扇区** | 把 A、B 写在**同一个扇区**内，验证覆盖问题 |
| 4 | 写超过 256 B，后半段出现在开头 | **页边界回卷**（`02h` 不跨页） | 从 `0x00F0` 开始写 32 B，读 `0x0000` 看有没有数据 |
| 5 | 切到硬件 SPI 直接**编译报错** | `msp_spi_hard_read_write_byte()` 里用了**未声明的 `dat`**（形参叫 `byte`） | 把 `SPI_HARD_SOFT_SWITCH` 改成 1 编译一次即可复现 |
| 6 | 移植到 W25Q128 后地址越界 | 容量/扇区数变了：4 MB→16 MB、1024→4096 扇区 | 重算 `addr / 4096` 的上限；核对 `90h`/`9Fh` 返回的设备 ID |
| 7 | 数据放几天就坏 | 擦写寿命（约 10 万次）用完，或**掉电时正在编程** | 加"写入完成标志"或双备份，别在同一地址狂写 |
| 8 | 写 Flash 时系统莫名复位 | 看门狗超时（见 §7.2） | 暂时注释看门狗，或改成非阻塞等待 |

---

## 九、自测题

1. GD25Q32 有多少个 4 KB 扇区？24 位地址能表示的最大字节地址是多少？
2. 为什么"把 1 个字节从 `0x55` 改成 `0xAA`"实际要花几十毫秒？
3. `bsp_flash_write()` 里那次多余的 `bsp_flash_wait_busy()` 为什么"多余但无害"？
4. `bsp_flash_read_id()` 里读的时候为什么要发 `0xFF`？发 `0x00` 行不行？
5. `CS` 在 `bsp_flash_write()` 里拉高的那一刻发生了什么？
6. 为什么本工程 `18cec36` 要把 `bsp_flash_init()` 里的 SPI 初始化整段注释掉？
7. `msp_spi_read_write_byte()` 相比旧的 `msp_spi_read_byte()` 省下了什么？
8. 软件 SPI（Mode 0）和硬件 SPI（`SPI_PL_PH = Mode 3`）为什么都能驱动这颗 Flash？

### 练习题

1. **修 3 个 bug**：`bsp_flash_write((uint8_t *)"hello", 0, 10)` 的越界、`erase_sector` 的注释范围、`msp_spi_hard_read_write_byte()` 的 `dat`，各写一版修正并说明理由。
2. **加"读-改-写"**：写一个 `bsp_flash_write_byte_keep(addr, byte)`，保证只改目标字节、不破坏同扇区其它数据。
3. **加页内分割**：写一个能跨页安全写入的 `bsp_flash_write_crosspage()`，内部按 256 B 切分。
4. **做一次耗时实测**：用 **SysTick 微秒计时**（第 01 篇）量出"擦 1 个扇区""编程 256 B""读 4 KB"的真实耗时，和 §7.1 的手册值对照（**这是理解"物理时间"最直接的一次实验**）。
5. **非阻塞化**：把 `bsp_flash_write()` 改造成状态机（`空闲 → 擦除中 → 编程中 → 完成`），主循环里轮询 `05h`，期间**继续喂狗并刷新 OLED**（综合用到第 05、12、21 篇）。
6. **移植 W25Q128**：按 §2.4 改容量相关常数，并加一句"读 `9Fh` 校验容量码"的自检。

---

## 附：提交清单

| # | 提交 | 时间 | 分支 | 说明 | 改动 |
| --- | --- | --- | --- | --- | --- |
| 1 | `915f21f` | 10-07 10:40 | main | [更新] flash 读取 移植 | 新建 `bsp_flash.c`(226) / `.h`(32)；`bsp_spi_init()` 自带完整 SPI 初始化；函数名 `GD25Q32_*`；`main.c` 加 `flash_test()`；`eide.yml` 加源文件 + 包含路径 |
| 2 | `18cec36` | 10-07 17:55 | main(**HEAD**) | [更新] flash gd25q32 封装 | 全部改名 `bsp_flash_*`；SPI 初始化整段注释、交回 `msp_spi_init()`；`msp_spi` 新增 `msp_spi_read_write_byte()`（软/硬各一份）；`main.c` 恢复 `msp_spi_init()` |

## 参考笔记

- `../../../NOTE/Textbook/SPI/SPI Flash🌟.mhtml` —— 教材原文（W25Q128 引脚说明、容量组织图、指令、封装改造思路、练习题）
- `../../../NOTE/Textbook/SPI/存储器介绍.mhtml` —— 存储器分类（本篇第一章的骨架，"NOR 可按字节寻址所以能跑程序"那句出自这里）
- `../../../NOTE/Textbook/SPI/SPI原理🌟🌟🌟.mhtml` / `GD32F4之SPI查询.mhtml` —— SPI 协议与引脚查询（第 16 篇主线）
- `../../../NOTE/Note/SPI.md` —— SPI 整理版笔记（CPOL/CPHA、存储器分类、软硬实现）
- `../../../NOTE/Doc/GD32F407/GD32F4xx_Firmware_Library_V3.2.0/Examples/USB/USB_Device/dev_firmware_update/src/gd25qxx.c` —— **官方 GD25Qxx 驱动**，本篇第三章的对照对象（`9Fh` + 连续轮询 + 32 KB 块擦）
- 相关篇目：[16 SPI 总线](16-SPI总线.md)（`read_write_byte` 的来龙去脉）、[18 OLED 显示屏](18-OLED显示屏.md)（同一条总线上的邻居）、[12 看门狗](12-看门狗.md) / [13 计时外设](13-专题-计时外设与频率计算.md)（§7.2 的窗口计算）、[22 通信协议](22-专题-通信协议汇总与比较.md)、[23 查手册](23-专题-如何查手册与数据手册.md)

> 本笔记仅作学习整理，内容来自本仓库真实提交记录；手册标称值（`tPP`/`tSE`/频率上限）请以手上芯片的 Datasheet 为准。
