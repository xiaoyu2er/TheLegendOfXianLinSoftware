package battle;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.ArrayList;
import javax.imageio.ImageIO;
import main.GameLauncher;
import scene.ScenePanel;

public class Shot2 {
  public static void main(String[] a) throws Exception {
    String out=a[0], script=a[1]; int frames=Integer.parseInt(a[2]); long gap=Long.parseLong(a[3]);
    boolean normalize = a.length>4 && a[4].equals("norm");
    File d=new File(out, script.replace(".txt","")); d.mkdirs();
    new GameLauncher(); Thread.sleep(2200);
    ScenePanel sp=GameLauncher.scenePanel;
    sp.initiation("剧情1.txt"); Thread.sleep(300);
    sp.initiation(script); Thread.sleep(400);

    ArrayList<String[]> b1=sp.getReader().getBattle1(), b0=sp.getReader().getBattle0();
    String[] info = (b1!=null? b1.get(0) : b0.get(0)).clone();
    System.out.println("原始背景路径: [" + info[0] + "]");
    if(normalize){ info[0]=info[0].replace('\\','/'); System.out.println("规范化后:     [" + info[0] + "]  存在=" + new File(info[0]).isFile()); }
    sp.fightEvent.fight(info);
    Thread.sleep(150);

    BattlePanel bp=GameLauncher.battlePanel;
    System.out.println("bg loaded = " + (bp.background!=null && bp.background.getWidth(null)>0)
       + " (w=" + (bp.background==null?-1:bp.background.getWidth(null)) + ")");
    int cmdFrames=0, skillFrames=0, drugFrames=0, instFrames=0, firstCmd=-1;
    for(int i=0;i<frames;i++){
      BufferedImage img=new BufferedImage(1024,640,BufferedImage.TYPE_INT_RGB);
      bp.paint(img.getGraphics());
      ImageIO.write(img,"png",new File(d,String.format("f%03d",i)+".png"));
      if(bp.command!=null   && bp.command.isDraw){   cmdFrames++;   if(firstCmd<0) firstCmd=i; }
      if(bp.skillMenu!=null && bp.skillMenu.isDraw)  skillFrames++;
      if(bp.drugMenu!=null  && bp.drugMenu.isDraw)   drugFrames++;
      if(bp.instruct!=null  && bp.instruct.isDraw)   instFrames++;
      Thread.sleep(gap);
    }
    System.out.println("command.isDraw  出现帧数=" + cmdFrames + " / " + frames + "  首次出现于 f" + firstCmd);
    System.out.println("skillMenu.isDraw=" + skillFrames + "  drugMenu.isDraw=" + drugFrames + "  instruct.isDraw=" + instFrames);
    System.exit(0);
  }
}
