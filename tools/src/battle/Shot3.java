package battle;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.ArrayList;
import javax.imageio.ImageIO;
import main.GameLauncher;
import scene.ScenePanel;

/** 会打架的战斗取景器：检测到指令菜单就点「击」，再点第一个活着的敌人。 */
public class Shot3 {
  // Command.java:33-58 里写死的按钮坐标
  static final int ATK_X = 500 + 58/2, ATK_Y = 300 + 62/2;

  static Enemy pick(BattlePanel bp){
    Enemy[] es = { bp.em1, bp.em2, bp.em3 };
    for (Enemy e : es) if (e != null && !e.isDead && e.hp > 0) return e;
    return null;
  }
  public static void main(String[] a) throws Exception {
    String out=a[0], script=a[1]; int frames=Integer.parseInt(a[2]); long gap=Long.parseLong(a[3]);
    File d=new File(out, script.replace(".txt","")); d.mkdirs();
    new GameLauncher(); Thread.sleep(2200);
    ScenePanel sp=GameLauncher.scenePanel;
    sp.initiation("剧情1.txt"); Thread.sleep(300);
    sp.initiation(script); Thread.sleep(400);
    ArrayList<String[]> b1=sp.getReader().getBattle1(), b0=sp.getReader().getBattle0();
    sp.fightEvent.fight((b1!=null? b1.get(0) : b0.get(0)).clone());
    Thread.sleep(150);
    BattlePanel bp=GameLauncher.battlePanel;

    int attacks=0, selects=0;
    for(int i=0;i<frames;i++){
      BufferedImage img=new BufferedImage(1024,640,BufferedImage.TYPE_INT_RGB);
      bp.paint(img.getGraphics());
      ImageIO.write(img,"png",new File(d,String.format("f%03d",i)+".png"));

      if (i % 20 == 0) System.out.printf("  f%03d isDraw=%-5s sel=%-5s round=%d em1=%s%n",
          i, bp.command.isDraw, bp.enemySlector.isSlectable, bp.currentRound, bp.em1==null?"null":"ok");
      if (bp.command.isDraw) {
        bp.currentX=ATK_X; bp.currentY=ATK_Y;
        bp.command.checkMoveIn(); bp.command.checkPressed(); bp.command.checkReleased();
        attacks++;
      } else if (bp.enemySlector.isSlectable) {
        Enemy t = pick(bp);
        if (t != null) {
          int cx = t.x + t.Images.get(0).getWidth(bp)/2;
          int cy = t.y + t.Images.get(0).getHeight(bp)/2;
          bp.currentX=cx; bp.currentY=cy;
          bp.enemySlector.checkMoveIn(cx,cy);
          bp.enemySlector.checkClick(cx,cy);
          selects++;
        }
      }
      Thread.sleep(gap);
    }
    System.out.println("点「击」次数=" + attacks + "  选敌次数=" + selects
      + "  剩余敌人 hp: " + hp(bp.em1) + "/" + hp(bp.em2) + "/" + hp(bp.em3));
    System.exit(0);
  }
  static String hp(Enemy e){ return e==null? "-" : (e.isDead? "dead" : String.valueOf(e.hp)); }
}
