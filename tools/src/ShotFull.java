import java.awt.image.BufferedImage;
import java.io.*;
import java.util.*;
import javax.imageio.ImageIO;
import javax.swing.JPanel;
import main.GameLauncher;
import scene.ScenePanel;
import tools.Reader;

public class ShotFull {
  static String out;
  static Map<String,int[]> tally = new LinkedHashMap<>(); // [ok, attempted]
  static List<String> errs = new ArrayList<>();

  static void bump(String k, boolean ok){ int[] v = tally.computeIfAbsent(k, x->new int[2]); v[1]++; if(ok) v[0]++; }

  static boolean shot(JPanel p, String sub, String name){
    try{
      File d = new File(out, sub); d.mkdirs();
      BufferedImage img = new BufferedImage(1024,640,BufferedImage.TYPE_INT_RGB);
      p.paint(img.getGraphics());
      ImageIO.write(img,"png",new File(d, name+".png"));
      return true;
    }catch(Throwable t){ errs.add(sub+"/"+name+" -> "+t); return false; }
  }
  static void nap(long ms){ try{Thread.sleep(ms);}catch(Exception e){} }

  static boolean has(String script, String section){
    try(BufferedReader br=new BufferedReader(new InputStreamReader(new FileInputStream("script/"+script),"GBK"))){
      String l; while((l=br.readLine())!=null) if(l.trim().equals(section)) return true;
    }catch(Exception e){}
    return false;
  }

  public static void main(String[] a) throws Exception {
    out=a[0]; new File(out).mkdirs();
    boolean doBattle = a.length>1 && a[1].equals("battle");
    new GameLauncher(); nap(2500);
    ScenePanel sp = GameLauncher.scenePanel;
    sp.initiation("剧情1.txt"); nap(400);   // 预热，规避 dialogueEvent 为 null

    File[] fs = new File("script").listFiles((d,n)->n.endsWith(".txt"));
    Arrays.sort(fs, Comparator.comparing(File::getName));

    if(!doBattle){
      for(File f: fs){
        String s=f.getName(), base=s.replace(".txt","");
        try{ sp.initiation(s); nap(140); }catch(Throwable t){ errs.add("init "+s+" -> "+t); bump("scene",false); continue; }
        bump("scene", shot(sp,"01-scene",base));

        if(has(s,"Dialogue")){
          Reader r=sp.getReader();
          int groups = (sp.dialogueEvent!=null && sp.dialogueEvent.dialogues!=null)? sp.dialogueEvent.dialogues.size() : 0;
          boolean any=false;
          for(int g=0; g<Math.min(groups,3); g++){
            try{
              sp.initiation(s); nap(140);
              sp.dialogueEvent.setDialogueOrder(g);
              sp.dialogueEvent.startSpeak();
              for(int t: new int[]{300,900,1800}){ nap(t==300?300:600); any |= shot(sp,"02-dialogue",base+"_g"+g+"_t"+t); }
            }catch(Throwable t){ errs.add("dlg "+s+" g"+g+" -> "+t); }
          }
          bump("dialogue", any);
        }

        if(has(s,"Narratage")){
          boolean any=false;
          try{ sp.initiation(s); nap(140); sp.narratage.begin();
            for(int i=0;i<4;i++){ nap(700); any |= shot(sp,"03-narratage",base+"_t"+i); }
          }catch(Throwable t){ errs.add("nar "+s+" -> "+t); }
          bump("narratage", any);
        }

        if(has(s,"SelectQuestion")){
          boolean any=false;
          try{ sp.initiation(s); nap(140);
            sp.selectEvent.showSelectQuestion(0); nap(500); any |= shot(sp,"04-question",base+"_select");
            sp.selectEvent.showQuestion(0);       nap(500); any |= shot(sp,"04-question",base+"_question");
          }catch(Throwable t){ errs.add("q "+s+" -> "+t); }
          bump("selectQuestion", any);
        }
        if(has(s,"SelectShopPanel")){
          boolean any=false;
          try{ sp.initiation(s); nap(140); sp.selectEvent.showSelectShopPanel(); nap(500); any=shot(sp,"05-select",base+"_shop"); }
          catch(Throwable t){ errs.add("selShop "+s+" -> "+t); }
          bump("selectShop", any);
        }
        if(has(s,"SelectEquipmentShopPanel")){
          boolean any=false;
          try{ sp.initiation(s); nap(140); sp.selectEvent.showSelectEquipmentShopPanel(); nap(500); any=shot(sp,"05-select",base+"_eqshop"); }
          catch(Throwable t){ errs.add("selEq "+s+" -> "+t); }
          bump("selectEqShop", any);
        }
        if(has(s,"SelectBattlePanel")){
          boolean any=false;
          try{ sp.initiation(s); nap(140); sp.selectEvent.showSelectBattlePanel(0); nap(500); any=shot(sp,"05-select",base+"_battle"); }
          catch(Throwable t){ errs.add("selBat "+s+" -> "+t); }
          bump("selectBattle", any);
        }
        if(has(s,"TreasureBox")){
          boolean any=false;
          try{ sp.initiation(s); nap(140);
            java.util.ArrayList<String[]> tb=sp.getReader().getTreasureBox();
            if(tb!=null && tb.size()>0){
              sp.equipmentEvent.checBoxes(Integer.parseInt(tb.get(0)[0]), Integer.parseInt(tb.get(0)[1]));
              nap(400); any=shot(sp,"06-treasure",base);
            }
          }catch(Throwable t){ errs.add("tb "+s+" -> "+t); }
          bump("treasureBox", any);
        }
      }
      // 其余 Panel
      bump("panel", shot(GameLauncher.startPanel,"07-panel","start"));
      bump("panel", shot(GameLauncher.lsPanel,"07-panel","loadsave"));
      bump("panel", shot(GameLauncher.shopPanel,"07-panel","shop"));
      bump("panel", shot(GameLauncher.equipmentShopPanel,"07-panel","equipmentShop"));
      bump("panel", shot(GameLauncher.menuPanel,"07-panel","menu-00"));
      int[] keys = {37,39,38,40,10};  // LEFT RIGHT UP DOWN ENTER
      for(int i=0;i<keys.length;i++){
        try{ GameLauncher.menuPanel.keyPressed(keys[i]); nap(350); bump("panel", shot(GameLauncher.menuPanel,"07-panel","menu-key"+keys[i])); }
        catch(Throwable t){ errs.add("menuKey "+keys[i]+" -> "+t); bump("panel",false); }
      }
      try{ GameLauncher.endPanel.start(); nap(800); bump("panel", shot(GameLauncher.endPanel,"07-panel","end")); }
      catch(Throwable t){ errs.add("end -> "+t); bump("panel",false); }
    } else {
      // 战斗单独一轮：每场连拍 30 帧 @100ms
      for(File f: fs){
        String s=f.getName(), base=s.replace(".txt","");
        if(!has(s,"Fight")) continue;
        boolean any=false;
        try{
          sp.initiation(s); nap(300);
          sp.fightEvent.startBattle1();
          nap(200);
          for(int i=0;i<30;i++){ any |= shot(GameLauncher.battlePanel,"08-battle/"+base, String.format("f%02d",i)); nap(100); }
        }catch(Throwable t){ errs.add("battle "+s+" -> "+t); }
        bump("battle", any);
      }
    }

    System.out.println("======== 覆盖统计 (ok / 尝试) ========");
    for(Map.Entry<String,int[]> e: tally.entrySet())
      System.out.printf("%-16s %3d / %3d%n", e.getKey(), e.getValue()[0], e.getValue()[1]);
    System.out.println("======== 错误 " + errs.size() + " 条 ========");
    for(int i=0;i<Math.min(errs.size(),25);i++) System.out.println("  "+errs.get(i));
    System.exit(0);
  }
}
