import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/entities/user.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { PostComment } from './entities/post-comment.entity';
import { PostLike } from './entities/post-like.entity';
import { Post } from './entities/post.entity';

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post)
    private readonly postsRepository: Repository<Post>,

    @InjectRepository(PostLike)
    private readonly likesRepository: Repository<PostLike>,

    @InjectRepository(PostComment)
    private readonly commentsRepository: Repository<PostComment>,

    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,

    private readonly notificationsService: NotificationsService,
  ) {}

  async create(authorId: string, dto: CreatePostDto): Promise<Post> {
    const content = dto.content.trim();

    if (!content) {
      throw new BadRequestException('Post content cannot be empty');
    }

    const post = this.postsRepository.create({
      authorId,
      content,
      imageUrl: dto.imageUrl?.trim() || null,
    });

    return this.postsRepository.save(post);
  }

  async findAll(page = 1, limit = 10) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(
      50,
      Math.max(1, Number(limit) || 10),
    );

    const [posts, total] =
      await this.postsRepository.findAndCount({
        order: {
          createdAt: 'DESC',
        },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      });

    const enrichedPosts = await Promise.all(
      posts.map(async (post) => {
        const [author, likeCount, commentCount] = await Promise.all([
          this.usersRepository.findOne({
            where: { id: post.authorId },
            select: {
              id: true,
              fullName: true,
              username: true,
              profilePhotoUrl: true,
              isVerified: true,
            },
          }),
          this.likesRepository.count({
            where: { postId: post.id },
          }),
          this.commentsRepository.count({
            where: { postId: post.id },
          }),
        ]);

        return {
          ...post,
          author: author
            ? {
                id: author.id,
                fullName: author.fullName,
                username: author.username,
                profilePhotoUrl: author.profilePhotoUrl,
                isVerified: author.isVerified,
              }
            : null,
          likeCount,
          commentCount,
        };
      }),
    );

    return {
      posts: enrichedPosts,
      page: safePage,
      limit: safeLimit,
      total,
      hasMore: safePage * safeLimit < total,
    };
  }

  async findOne(id: string): Promise<Post> {
    const post = await this.postsRepository.findOne({
      where: { id },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  async findOneDetailed(id: string, userId: string) {
    const post = await this.findOne(id);

    const [author, likeCount, commentCount, existingLike] =
      await Promise.all([
        this.usersRepository.findOne({
          where: { id: post.authorId },
          select: {
            id: true,
            fullName: true,
            username: true,
            profilePhotoUrl: true,
            isVerified: true,
          },
        }),
        this.likesRepository.count({
          where: { postId: post.id },
        }),
        this.commentsRepository.count({
          where: { postId: post.id },
        }),
        this.likesRepository.findOne({
          where: {
            postId: post.id,
            userId,
          },
        }),
      ]);

    return {
      ...post,
      author: author
        ? {
            id: author.id,
            fullName: author.fullName,
            username: author.username,
            profilePhotoUrl: author.profilePhotoUrl,
            isVerified: author.isVerified,
          }
        : null,
      likeCount,
      commentCount,
      liked: Boolean(existingLike),
    };
  }

  async remove(id: string, authorId: string): Promise<void> {
    const post = await this.findOne(id);

    if (post.authorId !== authorId) {
      throw new BadRequestException(
        'You can only delete your own posts',
      );
    }

    await this.postsRepository.remove(post);
  }

  async toggleLike(postId: string, userId: string) {
    const post = await this.findOne(postId);

    const existing = await this.likesRepository.findOne({
      where: {
        postId,
        userId,
      },
    });

    if (existing) {
      await this.likesRepository.remove(existing);

      return {
        liked: false,
        likeCount: await this.likesRepository.count({
          where: { postId },
        }),
      };
    }

    await this.likesRepository.save(
      this.likesRepository.create({
        postId,
        userId,
      }),
    );

    if (post.authorId !== userId) {
      await this.notificationsService.createNotification({
        recipientId: post.authorId,
        type: 'post_like',
        title: 'New like',
        message: 'Someone liked your post.',
        relatedUserId: userId,
      });
    }

    return {
      liked: true,
      likeCount: await this.likesRepository.count({
        where: { postId },
      }),
    };
  }

  async getComments(postId: string) {
    await this.findOne(postId);

    const comments = await this.commentsRepository.find({
      where: { postId },
      order: {
        createdAt: 'ASC',
      },
    });

    return Promise.all(
      comments.map(async (comment) => {
        const author = await this.usersRepository.findOne({
          where: { id: comment.userId },
          select: {
            id: true,
            fullName: true,
            username: true,
            profilePhotoUrl: true,
            isVerified: true,
          },
        });

        return {
          ...comment,
          author: author
            ? {
                id: author.id,
                fullName: author.fullName,
                username: author.username,
                profilePhotoUrl: author.profilePhotoUrl,
                isVerified: author.isVerified,
              }
            : null,
        };
      }),
    );
  }

  async addComment(
    postId: string,
    userId: string,
    dto: CreateCommentDto,
  ) {
    const post = await this.findOne(postId);

    const content = dto.content.trim();

    if (!content) {
      throw new BadRequestException('Comment cannot be empty');
    }

    const comment = this.commentsRepository.create({
      postId,
      userId,
      content,
    });

    const saved = await this.commentsRepository.save(comment);

    if (post.authorId !== userId) {
      await this.notificationsService.createNotification({
        recipientId: post.authorId,
        type: 'post_comment',
        title: 'New comment',
        message: 'Someone commented on your post.',
        relatedUserId: userId,
        relatedMessageId: saved.id,
      });
    }

    return saved;
  }

  async deleteComment(commentId: string, userId: string) {
    const comment = await this.commentsRepository.findOne({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.userId !== userId) {
      throw new BadRequestException(
        'You can only delete your own comments',
      );
    }

    await this.commentsRepository.remove(comment);

    return {
      message: 'Comment deleted successfully',
    };
  }
}
