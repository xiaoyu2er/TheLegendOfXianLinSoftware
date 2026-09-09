import type { FakeId } from './fake'

/** 登记册里的一行。 */
export interface FakeEntry {
  /** 真的那一份归哪张 bd 票。**写票号，不写"以后"。** */
  readonly owner: string
  /** 顶替的是原版的哪个类。 */
  readonly original: string
  /** 这一份假在哪 —— 真货做出来时，这一行就是该拆掉的清单。 */
  readonly fakeBecause: string
  /**
   * 这个假货**导出**了哪些函数名。`registry.test.ts` 拿它做"两套并存"检查：
   * 同一个名字在 `web/src/` 里只许有一个文件导出。真货做出来却忘了拆假货时，
   * 这一条会红 —— 而"两套并存"与"一套正常工作"长得一样，正是 ADR-0005 的
   * 那句话。
   */
  readonly exports: readonly string[]
}

/**
 * **假货登记册**（ADR-0005）。
 *
 * ⚠️ **这张表必须手写。** 写成"扫磁盘现算"的那一刻，它就变成了让被守的东西
 * 自己给自己签字 —— `registry.test.ts` 的四段断言会同时变成恒真，而
 * "全都登记好了"与"一条都没验"长得一样。dispatch.md 纪律 3 禁的是把**分母**
 * 写死；这里分母是磁盘上扫出来的 `declareFake` 调用，写死的是**登记**。
 *
 * 加一样假货 = 在它的模块里 `declareFake('<id>')` + 在这里写一行。少哪一半
 * 都会红，见 `registry.test.ts`。
 */
export const REGISTERED_FAKES: Readonly<Record<FakeId, FakeEntry>> = {
  drugPack: {
    owner: 'xl-6lo.1',
    original: 'shop.DrugPack',
    fakeBecause:
      '不读 sources/Drug/，没有出厂表，于是来者不拒 —— 原版 addDrug 找不到名字时什么都不做；' +
      '也没有 Drug 的价格 / 说明 / 图标。',
    exports: ['addDrug', 'drugCount', 'drugEntries', 'resetDrugPack'],
  },
  equipmentPack: {
    owner: 'xl-6lo.1',
    original: 'shop.EquipmentPack',
    fakeBecause:
      '不分头 / 盔甲 / 武器 / 手 / 脚 / 饰品六类，不读 sources/，同样来者不拒；' +
      '没有 Equipment 的属性加成与部位。',
    exports: ['addEqupment', 'equipmentCount', 'equipmentEntries', 'resetEquipmentPack'],
  },
  party: {
    owner: 'xl-6lo.1',
    original: 'battle.ZhangXiaoFan / YuJie / LuXueQi 那三组静态字段',
    fakeBecause:
      '不读也不写 save/，初值是三个类的静态字段初值（1 / 3 / 1 级 + 开局那三把武器的加成），' +
      '刷新页面就回到开局；跨战斗与跨菜单只记等级 / 经验 / 血 / 灵力 / 死没死 / 怒气 / ' +
      '四项基础属性十样，isGetSkill、skillNumber 今天在 web 端还没有来源（M3）；' +
      '装备只记它加出来的属性，"穿的是哪一件"记不住（xl-6lo.18）。',
    exports: [
      'getParty',
      'partyLevels',
      'partyAttributes',
      'rememberParty',
      'rememberMenuParty',
      'expToNextLevel',
      'resetParty',
      'initialMember',
    ],
  },
  wallet: {
    owner: 'xl-knp.1',
    original: 'shop.Money',
    fakeBecause:
      '初值是抄来的常量 10000 而不是从存档读的；只做了加法，reduceCoins 故意没做 —— ' +
      '战斗结算不花钱，补一个没人调的方法只会造出"看起来做完了"的假象。',
    exports: ['getCoins', 'addCoins', 'resetWallet'],
  },
}
