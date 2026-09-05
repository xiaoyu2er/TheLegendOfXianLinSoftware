package battle;
import java.awt.image.BufferedImage;
import java.util.ArrayList;
import main.GameLauncher; import scene.ScenePanel; import tools.Clock;

/** 测量 Clock.factor 对战斗节奏（行动条填满 → 指令菜单弹出）的影响是否线性。 */
public class SpeedProbe {
  public static void main(String[] a) throws Exception {
    String script=a[0]; double factor=Double.parseDouble(a[1]);
    Clock.setFactor(factor);
    new GameLauncher(); Thread.sleep(2200);
    ScenePanel sp=GameLauncher.scenePanel;
    sp.initiation("剧情1.txt"); Thread.sleep(300);
    sp.initiation(script); Thread.sleep(400);
    ArrayList<String[]> b1=sp.getReader().getBattle1(), b0=sp.getReader().getBattle0();
    sp.fightEvent.fight((b1!=null?b1.get(0):b0.get(0)).clone());
    BattlePanel bp=GameLauncher.battlePanel;
    BufferedImage img=new BufferedImage(1024,640,BufferedImage.TYPE_INT_RGB);
    long t0=System.currentTimeMillis(); int paints=0;
    while (System.currentTimeMillis()-t0 < 60000) {
      bp.paint(img.getGraphics()); paints++;
      if (paints % 400 == 0) {
        System.out.printf("  hp: 张=%s 雨=%s 陆=%s | 敌=%s  pbDraw=%s cmdDraw=%s%n",
          bp.zxf==null?"-":bp.zxf.getHp()+(bp.zxf.isDead?"(死)":""),
          bp.yj==null?"-":bp.yj.getHp()+(bp.yj.isDead?"(死)":""),
          bp.lxq==null?"-":bp.lxq.getHp()+(bp.lxq.isDead?"(死)":""),
          bp.em1==null?"-":bp.em1.hp+(bp.em1.isDead?"(死)":""),
          bp.progressBar.isDraw, bp.command.isDraw);
      }
      if (bp.command.isDraw) {
        System.out.printf("factor=%.1f  指令菜单出现: %5dms  (paint %d 次)%n",
          factor, System.currentTimeMillis()-t0, paints);
        System.exit(0);
      }
      Thread.sleep(5);
    }
    System.out.printf("factor=%.1f  60s 内未出现 (paint %d 次)%n", factor, paints);
    System.exit(1);
  }
}
