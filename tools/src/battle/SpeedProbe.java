package battle;
import java.awt.image.BufferedImage;
import java.util.ArrayList;
import main.GameLauncher; import scene.ScenePanel;

/** 测量：提高 paint() 调用频率能否加速战斗状态机（行动条填满 → 指令菜单弹出）。 */
public class SpeedProbe {
  public static void main(String[] a) throws Exception {
    String script=a[0]; long gap=Long.parseLong(a[1]);
    new GameLauncher(); Thread.sleep(2200);
    ScenePanel sp=GameLauncher.scenePanel;
    sp.initiation("剧情1.txt"); Thread.sleep(300);
    sp.initiation(script); Thread.sleep(400);
    ArrayList<String[]> b1=sp.getReader().getBattle1(), b0=sp.getReader().getBattle0();
    sp.fightEvent.fight((b1!=null?b1.get(0):b0.get(0)).clone());
    Thread.sleep(150);
    BattlePanel bp=GameLauncher.battlePanel;
    BufferedImage img=new BufferedImage(1024,640,BufferedImage.TYPE_INT_RGB);
    long t0=System.currentTimeMillis(); int paints=0;
    while (System.currentTimeMillis()-t0 < 30000) {
      bp.paint(img.getGraphics()); paints++;
      if (bp.command.isDraw) {
        System.out.printf("gap=%3dms  指令菜单出现: 用时 %5dms, 共 paint %5d 次%n",
          gap, System.currentTimeMillis()-t0, paints);
        System.exit(0);
      }
      if (gap>0) Thread.sleep(gap);
    }
    System.out.printf("gap=%3dms  30s 内未出现（paint %d 次）%n", gap, paints);
    System.exit(1);
  }
}
