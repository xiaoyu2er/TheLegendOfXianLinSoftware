package media;

public class MusicReader {
	static MusicPlayer background =new MusicPlayer("sources/BGM");
	static MusicPlayer music= new MusicPlayer("sources/music");
	
	 public static void readBGM(String s){
		 background.play(s);
	 }
	 
	 public static void readmusic(String s){
		// 观察点：这一行在 playmusic 的 CAN_PLAY_MUSIC 判断之外，静音导出真值时
		// 也记得下来。默认关闭，是空操作。见 tools.MusicLog 与 bd xl-1vu.8。
		tools.MusicLog.record(s);
		music.playmusic(s);
	 }
	 
	 //关闭背景音乐
	 public static void closeBGM(){
		 MusicPlayer.CAN_PLAY_BGM=MusicPlayer.NO;
	 }
	 public static void openBGM(){
		 background.play(background.currentPlayingBGM);
		 MusicPlayer.CAN_PLAY_BGM=MusicPlayer.YES;
	 }
	 //关闭音效
	 public static void closeMusic(){
		 MusicPlayer.CAN_PLAY_MUSIC=MusicPlayer.NO;
	 }
	 public static void openMusic(){
		 MusicPlayer.CAN_PLAY_MUSIC=MusicPlayer.YES;
	 }
}
